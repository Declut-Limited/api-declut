import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  DisputeStatus,
  InspectionOutcome,
  InspectionStatus,
  PaymentMethod,
  Transaction,
  TransactionDocument,
  TransactionStatus,
} from './schemas/transaction.schema';
import {
  TransactionNote,
  TransactionNoteDocument,
} from './schemas/transaction-note.schema';
import {
  Refund,
  RefundDocument,
  RefundStatus,
  RefundTriggeredByType,
} from './schemas/refund.schema';
import { Payout, PayoutDocument, PayoutStatus } from './schemas/payout.schema';
import { Admin, AdminDocument } from '../admin-auth/schemas/admin.schema';
import {
  Report,
  ReportDocument,
  ReportStatus,
} from '../reports/schemas/report.schema';
import { Dispute, DisputeDocument } from '../disputes/schemas/dispute.schema';
import { InspectionReminderType } from './dto/inspection-reminder-type.enum';
import { EscrowStatus } from '../escrow/schemas/escrow.schema';
import { EscrowService } from '../escrow/escrow.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { PurchaseStatusFilter } from './dto/list-purchases.dto';
import { ListingsService } from '../listings/listings.service';
import { ListingStatus } from '../listings/schemas/listing.schema';
import { UsersService } from '../users/users.service';
import { PaystackService } from '../payments/paystack.service';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationChannelStatus,
  NotificationDocument,
  NotificationRecipientType,
} from '../notifications/schemas/notification.schema';
import { NotificationSettingsService } from '../notification-settings/notification-settings.service';
import { SettingsService } from '../settings/settings.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CounterService } from '../common/counter/counter.service';
import { BankAccountsService } from '../bank-accounts/bank-accounts.service';
import {
  formatNairaFull,
  formatNairaShort,
} from '../common/utils/currency.util';
import { pctTrend, breachTrend, Trend } from '../common/utils/trend.util';
import { MONTH_ABBREVIATIONS } from '../common/utils/date.util';
import { PopulatedParty, shapeParty } from '../common/utils/party.util';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { DateRangeDto } from '../common/dto/date-range.dto';
import { toCsv } from '../common/utils/csv.util';

interface PaystackWebhookPayload {
  event: string;
  data?: { reference?: string };
}

const PARTY_POPULATE_FIELDS = 'name email accountStatus slug company';
const LISTING_POPULATE_FIELDS = 'title mainImageUrl slug';
// Detail-view-only (GET /admin/transactions/:idOrSlug) — deliberately not
// used by the list/user-facing paths above, same "detail view gets extra
// fields, list doesn't" precedent Listings already established.
const ADMIN_DETAIL_LISTING_FIELDS =
  'title mainImageUrl images video category specs condition price description slug status createdAt hasDefect defectDescription location locationLabel address';
// Flat rate kept on a buyer-initiated cancel-purchase refund — fixed, not
// tied to AppSettings' (admin-configurable) commissionPercentage.
const CANCELLATION_FEE_PERCENTAGE = 10;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Human-readable elapsed/total duration for the admin detail's insights.transactionDuration.
function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / (60 * 1000));
  if (totalMinutes < 1) {
    return 'less than a minute';
  }
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}, ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectModel(TransactionNote.name)
    private transactionNoteModel: Model<TransactionNoteDocument>,
    @InjectModel(Refund.name)
    private refundModel: Model<RefundDocument>,
    @InjectModel(Payout.name)
    private payoutModel: Model<PayoutDocument>,
    @InjectModel(Admin.name)
    private adminModel: Model<AdminDocument>,
    @InjectModel(Report.name)
    private reportModel: Model<ReportDocument>,
    @InjectModel(Dispute.name)
    private disputeModel: Model<DisputeDocument>,
    private readonly escrowService: EscrowService,
    private readonly listingsService: ListingsService,
    private readonly usersService: UsersService,
    private readonly paystackService: PaystackService,
    private readonly trustScoreService: TrustScoreService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationSettingsService: NotificationSettingsService,
    private readonly settingsService: SettingsService,
    private readonly auditLogService: AuditLogService,
    private readonly counterService: CounterService,
    private readonly bankAccountsService: BankAccountsService,
  ) {}

  async create(buyerId: string, dto: CreateTransactionDto) {
    this.logger.log(
      `[checkout] create() start — buyer=${buyerId} listing=${dto.listingId} callbackUrl=${dto.callbackUrl ?? '(none, will use server default)'}`,
    );
    const listing = await this.listingsService.findById(dto.listingId);
    if (listing.seller.toString() === buyerId) {
      throw new BadRequestException('You cannot buy your own listing');
    }
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('This item is no longer available');
    }

    const existingPending = await this.transactionModel.findOne({
      listing: dto.listingId,
      buyer: buyerId,
      status: TransactionStatus.PENDING_PAYMENT,
    });
    if (existingPending) {
      this.logger.warn(
        `[checkout] blocked — buyer=${buyerId} already has pending_payment transaction ${existingPending._id.toString()} (reference=${existingPending.reference}) for listing=${dto.listingId}`,
      );
      throw new ConflictException(
        'You already have a checkout in progress for this listing',
      );
    }

    const amount = listing.price;

    const seller = await this.usersService.findById(listing.seller.toString());
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }
    if (!seller.hasPayoutDetails) {
      throw new BadRequestException(
        "This seller hasn't set up payout details yet — they need to add bank details before this listing can be purchased",
      );
    }

    const bankAccount = await this.bankAccountsService.findRawByUser(
      seller._id.toString() || seller?.id.toString(),
    );
    if (!bankAccount) {
      // Shouldn't happen (hasPayoutDetails is only ever set once a BankAccount exists), but a money-movement step should never assume — always re-check.
      throw new InternalServerErrorException(
        'Seller payout details are missing',
      );
    }

    let subaccountCode = bankAccount.paystackSubaccountCode;
    if (!subaccountCode) {
      this.logger.log(
        `[checkout] no cached subaccount for seller=${seller._id.toString()} — creating one on Paystack`,
      );
      subaccountCode = await this.paystackService.createSubaccount({
        businessName: seller.name,
        bankCode: bankAccount.bankCode,
        accountNumber: bankAccount.accountNumber,
      });
      await this.bankAccountsService.setPaystackSubaccountCode(
        bankAccount._id.toString(),
        subaccountCode,
      );
      this.logger.log(`[checkout] created subaccount=${subaccountCode}`);
    } else {
      this.logger.log(`[checkout] reusing cached subaccount=${subaccountCode}`);
    }

    const buyer = await this.usersService.findById(buyerId);
    if (!buyer) {
      throw new NotFoundException('Buyer not found');
    }

    const { commissionPercentage } = await this.settingsService.get();

    const year = new Date().getFullYear();
    const reference = `TXN-${year}-${String(
      await this.counterService.next(`transaction-${year}`),
    ).padStart(5, '0')}`;

    // Paystack call happens before the local record is persisted so a failed
    // call leaves nothing orphaned to clean up. The counter now increments
    // just before it too (Paystack needs a reference as an input, not an
    // output) — a failed checkout attempt after this point leaves a gap in
    // the TXN-YYYY-##### sequence, an accepted trade-off for having one
    // single reference instead of a separate internal-only Paystack key.
    this.logger.log(
      `[checkout] calling Paystack initialize — reference=${reference} amountKobo=${Math.round(amount * 100)} subaccount=${subaccountCode} callbackUrl=${dto.callbackUrl ?? '(server default)'}`,
    );
    const init = await this.paystackService.initializeTransaction({
      email: buyer.email,
      amountKobo: Math.round(amount * 100),
      reference,
      subaccountCode,
      callbackUrl: dto.callbackUrl,
    });
    this.logger.log(
      `[checkout] Paystack initialize OK — reference=${reference} authorizationUrl=${init.authorizationUrl}`,
    );

    const transaction = await this.transactionModel.create({
      listing: dto.listingId,
      buyer: buyerId,
      seller: listing.seller,
      amount,
      commissionPercentage,
      status: TransactionStatus.PENDING_PAYMENT,
      reference,
    });

    await this.audit(
      transaction._id.toString(),
      'checkout_initiated',
      buyerId,
      'none',
      TransactionStatus.PENDING_PAYMENT,
    );

    this.logger.log(
      `[checkout] create() done — transactionId=${transaction._id.toString()} reference=${reference}`,
    );
    return {
      transactionId: transaction._id.toString(),
      paystackAuthorizationUrl: init.authorizationUrl,
    };
  }

  async handlePaystackWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<void> {
    this.logger.log(
      `[webhook] received — bytes=${rawBody.length} hasSignatureHeader=${!!signature}`,
    );
    if (!this.paystackService.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('[webhook] signature verification FAILED — rejecting');
      throw new UnauthorizedException('Invalid webhook signature');
    }
    this.logger.log('[webhook] signature OK');

    const payload = JSON.parse(
      rawBody.toString('utf8'),
    ) as PaystackWebhookPayload;
    this.logger.log(
      `[webhook] event=${payload.event} reference=${payload.data?.reference ?? '(none)'}`,
    );
    if (payload.event !== 'charge.success') {
      this.logger.log(
        `[webhook] ignoring non-charge.success event: ${payload.event}`,
      );
      return;
    }

    const reference = payload.data?.reference;
    if (!reference) {
      this.logger.warn('[webhook] payload missing data.reference — ignoring');
      return;
    }

    const transaction = await this.transactionModel.findOne({
      reference,
    });
    if (!transaction) {
      this.logger.warn(
        `[webhook] no local transaction found for reference=${reference}`,
      );
      return;
    }
    this.logger.log(
      `[webhook] matched transaction=${transaction._id.toString()} reference=${reference} currentStatus=${transaction.status}`,
    );

    // Idempotency: a retried webhook for a transaction already past pending_payment is a no-op, not a re-activation.
    if (transaction.status !== TransactionStatus.PENDING_PAYMENT) {
      this.logger.log(
        `[webhook] transaction=${transaction._id.toString()} already past pending_payment (status=${transaction.status}) — no-op`,
      );
      return;
    }

    // Don't trust the webhook payload alone — re-verify server-to-server.
    const verification =
      await this.paystackService.verifyTransaction(reference);
    this.logger.log(
      `[webhook] server-to-server verify for reference=${reference} — successful=${verification.successful} amountKobo=${verification.amountKobo}`,
    );
    if (!verification.successful) {
      this.logger.warn(
        `[webhook] verification NOT successful for reference=${reference} — not activating escrow`,
      );
      return;
    }

    // Only underpayment is suspicious enough to block — Paystack legitimately collects more than
    // the listing price on channels that gross its own transaction fee onto the payer (the buyer
    // bears this, not Declut; see Transaction.paystackFee). Rejecting on `!==` was blocking every
    // real payment made through such a channel outright.
    const expectedKobo = Math.round(transaction.amount * 100);
    if (verification.amountKobo < expectedKobo) {
      this.logger.error(
        `[webhook] UNDERPAYMENT for transaction=${transaction._id.toString()} reference=${reference} — expected=${expectedKobo} received=${verification.amountKobo}`,
      );
      await this.audit(
        transaction._id.toString(),
        'payment_amount_mismatch',
        'webhook',
        transaction.status,
        transaction.status,
        { expectedKobo, receivedKobo: verification.amountKobo },
      );
      return;
    }

    const paystackFeeKobo = verification.amountKobo - expectedKobo;
    if (paystackFeeKobo > 0) {
      this.logger.log(
        `[webhook] transaction=${transaction._id.toString()} reference=${reference} — buyer paid a ₦${(paystackFeeKobo / 100).toFixed(2)} surplus over the listing price (Paystack's own fee, grossed onto the payer by the channel used) — recording, not blocking`,
      );
    }
    // Only 'card' is tracked as its own bucket — every other real Paystack
    // channel (bank/ussd/qr/mobile_money/eft/bank_transfer) folds into
    // BANK_TRANSFER, per explicit instruction.
    const paymentMethod =
      verification.channel === 'card'
        ? PaymentMethod.CARD
        : PaymentMethod.BANK_TRANSFER;

    // Claim the listing before finalizing escrow — atomic, so two webhooks
    // racing for the same listing (two buyers both reached pending_payment
    // before either paid) can't both win. The loser's money has already
    // moved on Paystack, so it's never auto-refunded here — flagged
    // disputed for an explicit admin decision, same as every other
    // stalled/disputed transaction in this app.
    const claimed = await this.listingsService.markPendingSale(
      transaction.listing.toString(),
    );
    if (!claimed) {
      const lostRaceOldStatus = transaction.status;
      transaction.status = TransactionStatus.DISPUTED;
      transaction.disputeStatus = DisputeStatus.UNDER_INVESTIGATION;
      transaction.inspectionStatus = InspectionStatus.FAILED;
      transaction.inspectionOutcome = InspectionOutcome.DISPUTED;
      transaction.gatewayProcessingFee = paystackFeeKobo / 100;
      transaction.paymentMethod = paymentMethod;
      await transaction.save();
      this.logger.error(
        `[webhook] transaction=${transaction._id.toString()} reference=${reference} paid but listing=${transaction.listing.toString()} is no longer active — likely claimed by another buyer's payment first. Flagged disputed for manual review.`,
      );
      await this.audit(
        transaction._id.toString(),
        'listing_unavailable_after_payment',
        'webhook',
        lostRaceOldStatus,
        TransactionStatus.DISPUTED,
      );
      await this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.buyer.toString(),
        type: 'listing_unavailable_after_payment',
        title: 'Payment received — action needed',
        body: 'This item became unavailable right as your payment cleared. Our team will reach out to resolve this.',
        data: { transactionId: transaction._id.toString() },
      });
      await this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.seller.toString(),
        type: 'listing_unavailable_after_payment',
        title: 'Sale on hold',
        body: 'A payment for your listing could not be completed because it was already claimed by another buyer. Our team is reviewing it.',
        data: { transactionId: transaction._id.toString() },
      });
      return;
    }

    const { inspectionWindow } = await this.settingsService.get();
    const oldStatus = transaction.status;
    const escrowActivatedAt = new Date();
    transaction.status = TransactionStatus.ESCROW_ACTIVE;
    transaction.inspectionDeadlineAt = new Date(
      escrowActivatedAt.getTime() +
        inspectionWindow.inspectionPeriod * 24 * 60 * 60 * 1000,
    );
    transaction.gatewayProcessingFee = paystackFeeKobo / 100;
    transaction.paymentMethod = paymentMethod;
    await transaction.save();

    // One Escrow per Transaction, created the moment payment is verified —
    // a standalone collection owned by EscrowModule. The two documents
    // reference each other: Escrow already points back at transactionId
    // (set above), and the returned id is written onto Transaction.escrow
    // here so either side can be reached from the other via .populate().
    const escrowId = await this.escrowService.createForTransaction({
      transactionId: transaction._id,
      listingId: transaction.listing,
      buyerId: transaction.buyer,
      sellerId: transaction.seller,
      amount: transaction.amount,
    });
    transaction.escrow = escrowId;
    await transaction.save();

    await this.audit(
      transaction._id.toString(),
      'escrow_held',
      'webhook',
      oldStatus,
      TransactionStatus.ESCROW_ACTIVE,
      paystackFeeKobo > 0 ? { paystackFeeKobo } : undefined,
    );
    this.logger.log(
      `[webhook] transaction=${transaction._id.toString()} reference=${reference} → escrow_active (escrow=${escrowId.toString()})`,
    );

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.seller.toString(),
      type: 'payment_received',
      title: 'Payment received',
      body: `₦${transaction.amount.toLocaleString()} is now held in escrow — meet the buyer to complete the sale.`,
      data: { transactionId: transaction._id.toString() },
    });
    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.buyer.toString(),
      type: 'payment_received',
      title: 'Payment confirmed',
      body: "Meet the seller, then confirm receipt in-app once you have the item — that's what releases their payment.",
      data: { transactionId: transaction._id.toString() },
    });
  }

  // Buyer-only, by explicit instruction — no confirmation code involved
  // anymore (the team dropped that process entirely). The buyer is the one
  // escrow is protecting, so they're the one who attests the item arrived;
  // that single call is what releases the seller's payout. Mirrors the old
  // confirmCode() success path exactly, minus the code check.
  async confirmReceipt(transactionId: string, buyerId: string) {
    const transaction = await this.findRaw(transactionId);
    if (transaction.buyer.toString() !== buyerId) {
      throw new ForbiddenException(
        'Only the buyer can confirm receipt for this transaction',
      );
    }
    if (
      ![
        TransactionStatus.ESCROW_ACTIVE,
        TransactionStatus.AWAITING_INSPECTION,
      ].includes(transaction.status)
    ) {
      throw new BadRequestException(
        `Transaction is ${transaction.status}, confirmation not available`,
      );
    }

    const seller = await this.usersService.findById(
      transaction.seller.toString(),
    );
    if (!seller?.hasPayoutDetails) {
      // Shouldn't happen (create() already required this), but a money-movement step should never assume — always re-check.
      throw new InternalServerErrorException(
        'Seller payout details are missing',
      );
    }
    const bankAccount = await this.bankAccountsService.findRawByUser(
      transaction.seller.toString(),
    );
    if (!bankAccount) {
      throw new InternalServerErrorException(
        'Seller payout details are missing',
      );
    }

    const rawCommission =
      (transaction.amount * transaction.commissionPercentage) / 100;
    const commissionAmount = Math.round(rawCommission * 100) / 100;
    const sellerPayoutAmount =
      Math.round((transaction.amount - commissionAmount) * 100) / 100;

    // Paystack call before the local write — same money-movement ordering rule as everywhere else in this module.
    const payoutReference = `declut_payout_${transaction._id.toString()}`;
    const transferResult = await this.paystackService.releaseToSeller({
      bankCode: bankAccount.bankCode,
      accountNumber: bankAccount.accountNumber,
      accountName: bankAccount.accountHolderName,
      amountKobo: Math.round(sellerPayoutAmount * 100),
      reference: payoutReference,
    });

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.COMPLETED;
    transaction.commissionAmount = commissionAmount;
    transaction.sellerPayoutAmount = sellerPayoutAmount;
    transaction.inspectionStatus = InspectionStatus.COMPLETED;
    transaction.inspectionOutcome = InspectionOutcome.ACCEPTED;
    transaction.buyerInspectionConfirmedAt = new Date();
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.RELEASED,
    );
    await this.listingsService.markSold(transaction.listing.toString());

    // Payout row only created here — the buyer-triggered release — per
    // explicit instruction, not from adminRelease(). Transaction.status is
    // still marked COMPLETED optimistically the moment Paystack accepts the
    // transfer (unchanged behavior); this row is the separate, accurate
    // record of whether the money actually landed, corrected by the
    // reconciliation sweep below if Paystack later reports otherwise.
    await this.payoutModel.create({
      transaction: transaction._id,
      user: transaction.seller,
      amount: sellerPayoutAmount,
      status:
        transferResult.status === 'success'
          ? PayoutStatus.SUCCESS
          : PayoutStatus.PENDING,
      triggeredBy: buyerId,
      payoutAccountNumber: bankAccount.accountNumber,
      payoutBankCode: bankAccount.bankCode,
      reference: payoutReference,
      transferCode: transferResult.transferCode,
      completedAt: transferResult.status === 'success' ? new Date() : undefined,
      slug: await this.counterService.nextSlug('payout', 'PYO', 4),
    });

    await this.audit(
      transactionId,
      'funds_released',
      buyerId,
      oldStatus,
      TransactionStatus.COMPLETED,
      { commissionAmount, sellerPayoutAmount },
    );

    // Completed-transaction count feeds both parties' trust score — recalculated here rather than live on every profile read.
    await Promise.all([
      this.trustScoreService.recalculate(transaction.buyer.toString()),
      this.trustScoreService.recalculate(transaction.seller.toString()),
    ]);

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.seller.toString(),
      type: 'funds_released',
      title: 'Funds released',
      body: `₦${sellerPayoutAmount.toLocaleString()} has been sent to your account.`,
      data: { transactionId },
    });
    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.buyer.toString(),
      type: 'funds_released',
      title: 'Sale completed',
      body: 'You confirmed receipt and the sale is complete. Leave a review!',
      data: { transactionId },
    });

    return { status: 'completed' };
  }

  // Buyer-initiated, self-serve, one-time. Must be requested WHILE the
  // original inspection window is still open (inspectionPeriodEnded still
  // false, inspectionDeadlineAt still has days left) — corrected 2026-09-13,
  // this is the inverse of an earlier pass, which wrongly required the
  // window to have already ended. allowExtension (the admin's own on/off
  // switch for the whole feature) is checked first, before either
  // per-transaction condition.
  async addInspectionExtension(transactionId: string, buyerId: string) {
    const transaction = await this.findRaw(transactionId);
    if (transaction.buyer.toString() !== buyerId) {
      throw new ForbiddenException(
        'Only the buyer can request an inspection extension',
      );
    }
    if (transaction.status !== TransactionStatus.ESCROW_ACTIVE) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — an extension can't be requested`,
      );
    }
    if (transaction.inspectionStatus !== InspectionStatus.AWAITING) {
      throw new BadRequestException(
        'Inspection has already been resolved for this transaction',
      );
    }

    const { inspectionWindow } = await this.settingsService.get();
    if (!inspectionWindow.allowExtension) {
      throw new BadRequestException(
        'Inspection extensions are currently disabled',
      );
    }
    if (transaction.inspectionExtended) {
      throw new BadRequestException(
        'You have already used your one-time inspection extension for this transaction',
      );
    }
    if (transaction.inspectionPeriodEnded) {
      throw new BadRequestException(
        'Your inspection window has already ended — an extension can no longer be requested',
      );
    }

    const baseDeadline = transaction.inspectionDeadlineAt ?? new Date();
    const extensionEndDate = new Date(
      baseDeadline.getTime() +
        inspectionWindow.maxExtensionPeriod * 24 * 60 * 60 * 1000,
    );

    await this.audit(
      transactionId,
      'inspection_extension_requested',
      buyerId,
      'not_extended',
      'not_extended',
      { requestedByDays: inspectionWindow.maxExtensionPeriod },
    );

    transaction.inspectionExtended = true;
    transaction.inspectionExtendedBy = inspectionWindow.maxExtensionPeriod;
    transaction.inspectionExtensionEndDate = extensionEndDate;
    await transaction.save();

    await this.audit(
      transactionId,
      'inspection_extended',
      buyerId,
      'not_extended',
      'extended',
      {
        extendedByDays: inspectionWindow.maxExtensionPeriod,
        extensionEndDate,
      },
    );

    await Promise.all([
      this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.buyer.toString(),
        type: 'inspection_extended',
        title: 'Inspection window extended',
        body: `Your inspection window was extended by ${inspectionWindow.maxExtensionPeriod} day(s).`,
        data: { transactionId },
      }),
      this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.seller.toString(),
        type: 'inspection_extended',
        title: 'Inspection window extended',
        body: `The buyer's inspection window was extended by ${inspectionWindow.maxExtensionPeriod} day(s).`,
        data: { transactionId },
      }),
    ]);

    return {
      inspectionExtended: transaction.inspectionExtended,
      inspectionExtendedBy: transaction.inspectionExtendedBy,
      inspectionExtensionEndDate: transaction.inspectionExtensionEndDate,
    };
  }

  // Buyer-initiated, self-serve — no admin involved. Only valid before
  // release (paid, still held in escrow), same states confirmReceipt()
  // operates on; once stalled/disputed, resolution moves to the admin-only
  // adminRefund()/adminRelease() path instead. Keeps a cancellation fee at
  // the transaction's own snapshotted commissionPercentage (same rate as a
  // normal sale) — the buyer gets the rest back, the fee simply isn't
  // refunded and stays in Declut's Paystack balance (no separate "split"
  // step needed for a partial refund).
  async cancelPurchaseWithRefund(transactionId: string, buyerId: string) {
    this.logger.log(
      `[cancel-purchase] start — transaction=${transactionId} buyer=${buyerId}`,
    );
    const transaction = await this.findRaw(transactionId);
    if (transaction.buyer.toString() !== buyerId) {
      throw new ForbiddenException('Only the buyer can cancel this purchase');
    }
    if (
      ![
        TransactionStatus.ESCROW_ACTIVE,
        TransactionStatus.AWAITING_INSPECTION,
      ].includes(transaction.status)
    ) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — this purchase can no longer be cancelled directly, contact support`,
      );
    }

    // Fixed 10% cancellation fee — deliberately not transaction.commissionPercentage
    // (that's the variable, admin-configurable sale commission rate; this fee is
    // a flat rate regardless of what commission was in effect at checkout).
    const rawFee = (transaction.amount * CANCELLATION_FEE_PERCENTAGE) / 100;
    const commissionAmount = Math.round(rawFee * 100) / 100;
    const refundAmount =
      Math.round((transaction.amount - commissionAmount) * 100) / 100;

    // Paystack call before the local write — same money-movement ordering rule as everywhere else in this module.
    this.logger.log(
      `[cancel-purchase] calling Paystack refund — transaction=${transactionId} reference=${transaction.reference} refundAmount=${refundAmount} cancellationFee=${commissionAmount}`,
    );
    await this.refundAndRecord({
      transactionId,
      buyerId: transaction.buyer.toString(),
      reference: transaction.reference,
      amountKobo: Math.round(refundAmount * 100),
      amount: refundAmount,
      reason: 'Cancelled by buyer before completing the purchase',
      triggeredByType: 'user',
      triggeredBy: buyerId,
    });

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.REFUNDED;
    transaction.commissionAmount = commissionAmount;
    transaction.inspectionStatus = InspectionStatus.FAILED;
    transaction.inspectionOutcome = InspectionOutcome.DISPUTED;
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.REFUNDED,
    );
    await this.listingsService.revertToActive(transaction.listing.toString());

    await this.audit(
      transactionId,
      'buyer_cancelled_with_refund',
      buyerId,
      oldStatus,
      TransactionStatus.REFUNDED,
      { commissionAmount, refundAmount },
    );
    this.logger.log(
      `[cancel-purchase] done — transaction=${transactionId} → refunded (refundAmount=${refundAmount}, commissionAmount kept=${commissionAmount})`,
    );

    await Promise.all([
      this.trustScoreService.recalculate(transaction.buyer.toString()),
      this.trustScoreService.recalculate(transaction.seller.toString()),
    ]);

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.buyer.toString(),
      type: 'purchase_cancelled_refunded',
      title: 'Purchase cancelled',
      body: `Your purchase was cancelled — ₦${refundAmount.toLocaleString()} has been refunded to you.`,
      data: { transactionId },
    });
    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.seller.toString(),
      type: 'purchase_cancelled_refunded',
      title: 'Purchase cancelled by buyer',
      body: 'The buyer cancelled their purchase before completing it — the listing is active again.',
      data: { transactionId },
    });

    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toResponseShape(transaction, buyerId);
  }

  // Called from ReportsService.create() whenever a buyer's report names a
  // transactionId — freezes that specific purchase: the transaction moves
  // to REPORTED and its escrow freezes, giving the seller a chance to
  // respond (refund or dispute) before an admin ever needs to step in.
  // Reworked 2026-09-17, explicit instruction: the client now names the
  // exact transaction directly (CreateReportDto.transactionId) instead of
  // this inferring an "active" one from listingId + the caller's own id —
  // so an ineligible transaction is now a real error (403/400), not a
  // silent no-op.
  async reportPurchase(
    transactionId: string,
    buyerId: string,
    listingId?: string,
  ): Promise<void> {
    const transaction = await this.findRaw(transactionId);
    if (transaction.buyer.toString() !== buyerId) {
      throw new ForbiddenException('Only the buyer can report this purchase');
    }
    if (listingId && transaction.listing.toString() !== listingId) {
      throw new BadRequestException(
        'This transaction is not for the given listing',
      );
    }
    if (
      ![
        TransactionStatus.ESCROW_ACTIVE,
        TransactionStatus.AWAITING_INSPECTION,
      ].includes(transaction.status)
    ) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — this purchase can't be reported`,
      );
    }

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.REPORTED;
    // A report ends the inspection window outright — it can't still be
    // "awaiting" once the buyer has flagged a problem. Explicit
    // instruction, 2026-09-17: inspectionStatus -> COMPLETED (not FAILED —
    // a deliberate departure from every other terminal inspectionStatus
    // write in this file, which always pairs COMPLETED with ACCEPTED and
    // FAILED with DISPUTED; here the window's process is "done" while the
    // outcome itself is DISPUTED), inspectionPeriodEnded -> true (so
    // sweepEndedInspectionPeriods() never also tries to auto-refund this
    // one), inspectionOutcome -> DISPUTED.
    transaction.inspectionStatus = InspectionStatus.COMPLETED;
    transaction.inspectionPeriodEnded = true;
    transaction.inspectionOutcome = InspectionOutcome.DISPUTED;
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.FROZEN,
    );

    await this.audit(
      transaction._id.toString(),
      'purchase_reported',
      buyerId,
      oldStatus,
      TransactionStatus.REPORTED,
    );

    await Promise.all([
      this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.seller.toString(),
        type: 'purchase_reported',
        title: 'A buyer reported this purchase',
        body: 'Respond by refunding the buyer or raising a dispute with your evidence.',
        data: { transactionId: transaction._id.toString() },
      }),
      this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.buyer.toString(),
        type: 'purchase_reported',
        title: 'Report submitted',
        body: "We've frozen this purchase's escrow while the seller responds.",
        data: { transactionId: transaction._id.toString() },
      }),
    ]);
  }

  // Seller-initiated, in response to a buyer's report — full refund, no
  // cancellation fee (unlike cancelPurchaseWithRefund, the buyer isn't
  // backing out here; the seller is accepting the complaint — judgment call,
  // flagged). Only valid while the transaction is REPORTED; once it's been
  // escalated to a dispute (see DisputesService), this path is no longer
  // available and resolution moves to the admin-only adminRefund()/
  // adminRelease() path, same as any other disputed transaction. 2026-09-16.
  async sellerRefundReportedPurchase(transactionId: string, sellerId: string) {
    const transaction = await this.findRaw(transactionId);
    if (transaction.seller.toString() !== sellerId) {
      throw new ForbiddenException(
        'Only the seller can respond to a report on this transaction',
      );
    }
    if (transaction.status !== TransactionStatus.REPORTED) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — a refund response is only available while the report is pending`,
      );
    }

    await this.refundAndRecord({
      transactionId,
      buyerId: transaction.buyer.toString(),
      reference: transaction.reference,
      amount: transaction.amount,
      amountKobo: Math.round(transaction.amount * 100),
      reason: 'Seller refunded the buyer in response to a report',
      triggeredByType: 'user',
      triggeredBy: sellerId,
    });

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.REFUNDED;
    transaction.inspectionStatus = InspectionStatus.FAILED;
    transaction.inspectionOutcome = InspectionOutcome.DISPUTED;
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.REFUNDED,
    );
    await this.listingsService.revertToActive(transaction.listing.toString());
    // No dispute was ever raised here — the report just closes as resolved,
    // same as the three admin dispute-resolution paths below.
    await this.closeActiveReportForListing(
      transaction.listing,
      transaction.buyer,
    );

    await this.audit(
      transactionId,
      'seller_refunded_reported_purchase',
      sellerId,
      oldStatus,
      TransactionStatus.REFUNDED,
      { refundAmount: transaction.amount },
    );

    await Promise.all([
      this.trustScoreService.recalculate(transaction.buyer.toString()),
      this.trustScoreService.recalculate(transaction.seller.toString()),
    ]);

    await Promise.all([
      this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.buyer.toString(),
        type: 'seller_refunded_report',
        title: 'Refund issued',
        body: `The seller refunded your report — ₦${transaction.amount.toLocaleString()} has been sent back to you.`,
        data: { transactionId },
      }),
      this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.seller.toString(),
        type: 'seller_refunded_report',
        title: 'Refund sent',
        body: 'You refunded the buyer in response to their report — the listing is active again.',
        data: { transactionId },
      }),
    ]);

    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toResponseShape(transaction, sellerId);
  }

  // Ownership + status guard shared by the dispute-submission flow
  // (DisputesService.create()) — a seller can only raise a dispute on their
  // own transaction, and only while it's REPORTED. Returns the raw
  // transaction so the caller can read .listing/.buyer to look up the
  // originating report. 2026-09-16.
  async getForSellerDispute(
    transactionId: string,
    sellerId: string,
  ): Promise<TransactionDocument> {
    const transaction = await this.findRaw(transactionId);
    if (transaction.seller.toString() !== sellerId) {
      throw new ForbiddenException(
        'Only the seller can raise a dispute on this transaction',
      );
    }
    if (transaction.status !== TransactionStatus.REPORTED) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — a dispute can only be raised on a reported transaction`,
      );
    }
    return transaction;
  }

  // Called by DisputesService right after the Dispute document is created.
  // Escrow was already frozen at the report stage (reportActivePurchase())
  // and stays frozen (explicit instruction) — only the transaction's own
  // status moves on, reusing the same DISPUTED status/disputeStatus field
  // the pre-existing payment-race auto-dispute already uses, so the
  // existing adminRelease()/adminRefund() resolution path applies here too
  // with no changes needed. 2026-09-16.
  async markDisputedFromSellerDispute(
    transactionId: string,
    sellerId: string,
  ): Promise<void> {
    const transaction = await this.findRaw(transactionId);
    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.DISPUTED;
    transaction.disputeStatus = DisputeStatus.UNDER_INVESTIGATION;
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.FROZEN,
    );

    await this.audit(
      transactionId,
      'seller_raised_dispute',
      sellerId,
      oldStatus,
      TransactionStatus.DISPUTED,
    );

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.buyer.toString(),
      type: 'dispute_raised',
      title: 'Seller raised a dispute',
      body: 'The seller disputed your report — an admin will review it.',
      data: { transactionId },
    });

    // Every admin, bell channel only — explicit instruction. dispute_raised_admin
    // has no push/email channels configured at all (see notification-types.ts),
    // so this only creates the in-app Notification row + fires the live
    // WebSocket bell (notify()'s unconditional emitToAdmin() for ADMIN
    // recipients), never an email.
    const adminIds = await this.notificationsService.getAllAdminIds();
    await Promise.all(
      adminIds.map((adminId) =>
        this.notificationsService.notify({
          recipientType: NotificationRecipientType.ADMIN,
          recipientId: adminId,
          type: 'dispute_raised_admin',
          title: 'New dispute raised',
          body: `A seller raised a dispute on transaction ${transaction.reference}.`,
          data: { transactionId },
        }),
      ),
    );
  }

  // Closes the still-open report tied to a buyer's report on this
  // transaction's listing — used only by sellerRefundReportedPurchase(),
  // where the seller refunded directly and no Dispute (and therefore no
  // Dispute.report link) was ever created. A no-op if none matches.
  // ReportStatus.NEW removed 2026-09-17 — INVESTIGATING is now the report's
  // actual starting state, so it's the correct "never escalated" filter here.
  private async closeActiveReportForListing(
    listingId: Types.ObjectId,
    buyerId: Types.ObjectId,
  ): Promise<void> {
    await this.reportModel.updateOne(
      {
        listing: listingId,
        reporter: buyerId,
        status: ReportStatus.INVESTIGATING,
      },
      { status: ReportStatus.RESOLVED },
    );
  }

  // Closes the Report behind a resolved dispute, via the Dispute document
  // linking transaction -> report (Report itself carries no transaction
  // reference). A transaction can reach DISPUTED two ways — a seller-raised
  // dispute (has a real Dispute+Report behind it) or the pre-existing
  // payment-race-loss auto-dispute (has neither) — this is a no-op for the
  // latter. Used by all three admin dispute-resolution actions below.
  private async closeReportIfDisputed(transactionId: string): Promise<void> {
    const dispute = await this.disputeModel
      .findOne({ transaction: transactionId })
      .exec();
    if (!dispute) {
      return;
    }
    await this.reportModel.updateOne(
      { _id: dispute.report },
      { status: ReportStatus.RESOLVED },
    );
  }

  async cancel(transactionId: string, buyerId: string) {
    const transaction = await this.findRaw(transactionId);
    if (transaction.buyer.toString() !== buyerId) {
      throw new ForbiddenException(
        'Only the buyer can cancel this transaction',
      );
    }
    if (transaction.status !== TransactionStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        'Only a transaction awaiting payment can be cancelled directly — for a paid transaction, use cancel-purchase instead',
      );
    }

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.CANCELLED;
    await transaction.save();

    await this.audit(
      transactionId,
      'cancelled_by_buyer',
      buyerId,
      oldStatus,
      TransactionStatus.CANCELLED,
    );

    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toResponseShape(transaction, buyerId);
  }

  // Raw — buyer/seller/listing stay unpopulated ObjectIds, since ReviewsService.create() reads them directly; see findForUserDisplay() for the populated variant returned to clients.
  async findForUser(transactionId: string, userId: string) {
    const transaction = await this.findRaw(transactionId);
    if (
      transaction.buyer.toString() !== userId &&
      transaction.seller.toString() !== userId
    ) {
      throw new ForbiddenException('You are not a party to this transaction');
    }
    return transaction;
  }

  // Backs ReviewsService's eligibility check — a buyer can only review a
  // listing they've actually completed a purchase for. Hands back the
  // seller id too, so the caller doesn't need a second lookup to know who
  // the review is about.
  async findCompletedPurchase(
    buyerId: string,
    listingId: string,
  ): Promise<{ sellerId: string } | null> {
    const transaction = await this.transactionModel
      .findOne({
        buyer: buyerId,
        listing: listingId,
        status: TransactionStatus.COMPLETED,
      })
      .select('seller');
    return transaction ? { sellerId: transaction.seller.toString() } : null;
  }

  // Backs the admin listing detail's `salesDetails` — the most recent
  // transaction against this listing, whatever status it's currently at
  // (not restricted to COMPLETED, unlike findCompletedPurchase() above — a
  // listing mid-escrow still has real sales details worth showing). buyer
  // populated the same way every other transaction read in this service
  // does (PARTY_POPULATE_FIELDS), even though only `name` is needed here,
  // for consistency. `paidAt` has no dedicated field on Transaction itself —
  // sourced from the linked Escrow's own createdAt (the exact moment
  // EscrowService.createForTransaction() creates it, itself the moment
  // payment was verified), null for a transaction that never got that far.
  // 2026-09-17, explicit instruction.
  async getSalesDetailsForListing(listingId: string): Promise<{
    buyer: { name: string; _id: string } | null;
    amountPaid: number;
    paymentMethod: PaymentMethod;
    paidAt: Date | null;
    transactionStatus: TransactionStatus;
  } | null> {
    const transaction = await this.transactionModel
      .findOne({ listing: listingId })
      .sort({ createdAt: -1 })
      .populate('buyer', PARTY_POPULATE_FIELDS)
      .populate('escrow', 'createdAt')
      .exec();
    if (!transaction) {
      return null;
    }
    const buyer = transaction.buyer as unknown as {
      _id: Types.ObjectId;
      name: string;
    } | null;
    const escrow = transaction.escrow as unknown as {
      createdAt: Date;
    } | null;
    return {
      buyer: buyer ? { name: buyer.name, _id: buyer._id.toString() } : null,
      amountPaid: transaction.amount,
      paymentMethod: transaction.paymentMethod,
      paidAt: escrow?.createdAt ?? null,
      transactionStatus: transaction.status,
    };
  }

  // findForUser() (called above) already enforces the buyer-or-seller
  // ownership check — see its ForbiddenException. `progress` is the
  // transaction's own full audit-log timeline (oldest-first, readable
  // labels) — detail-view-only, not added to toResponseShape() itself,
  // since that's shared by list endpoints (GET /transactions, /purchases)
  // where fetching a timeline per row would be an N+1 query.
  async findForUserDisplay(transactionId: string, userId: string) {
    const transaction = await this.findForUser(transactionId, userId);
    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    const shaped = this.toResponseShape(transaction, userId);
    shaped.progress = await this.auditLogService.findTimelineForEntity(
      'transaction',
      transactionId,
    );
    return shaped;
  }

  // Looked up by the Paystack `reference` Paystack itself appends to callback_url (?reference=...)
  // — used by the app's payment-callback deep-link route to resolve a transaction when it's
  // entered cold (app was killed/backgrounded mid-checkout, so there's no in-memory transactionId
  // to fall back on the way the live in-WebView redirect handler has).
  async findForUserDisplayByReference(reference: string, userId: string) {
    this.logger.log(
      `[deep-link] by-reference lookup — reference=${reference} requestedBy=${userId}`,
    );
    const transaction = await this.transactionModel.findOne({ reference });
    if (!transaction) {
      this.logger.warn(
        `[deep-link] no transaction found for reference=${reference}`,
      );
      throw new NotFoundException('Transaction not found');
    }
    if (
      transaction.buyer.toString() !== userId &&
      transaction.seller.toString() !== userId
    ) {
      this.logger.warn(
        `[deep-link] user=${userId} is not a party to transaction=${transaction._id.toString()} (reference=${reference})`,
      );
      throw new ForbiddenException('You are not a party to this transaction');
    }
    this.logger.log(
      `[deep-link] resolved reference=${reference} → transaction=${transaction._id.toString()} status=${transaction.status}`,
    );
    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toResponseShape(transaction, userId);
  }

  async listForUser(userId: string, page = 1, limit = 20) {
    const results = await this.transactionModel
      .find({ $or: [{ buyer: userId }, { seller: userId }] })
      .populate('buyer', PARTY_POPULATE_FIELDS)
      .populate('seller', PARTY_POPULATE_FIELDS)
      .populate('listing', LISTING_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    return {
      results: results.map((t) => this.toResponseShape(t, userId)),
      page,
      limit,
    };
  }

  // Buyer-only view — "my purchases," distinct from listForUser() which mixes
  // both roles. `status` is a small named-group filter, not a raw enum value:
  // 'active' maps to awaiting_inspection specifically (not escrow_active too)
  // per explicit instruction. Omitting `status` returns every purchase
  // regardless of status, including pending_payment/escrow_active/stalled/
  // cancelled — those just don't have a named filter value yet.
  private static readonly PURCHASE_STATUS_MAP: Record<
    PurchaseStatusFilter,
    TransactionStatus
  > = {
    active: TransactionStatus.ESCROW_ACTIVE,
    completed: TransactionStatus.COMPLETED,
    refunded: TransactionStatus.REFUNDED,
    disputed: TransactionStatus.DISPUTED,
  };

  async listPurchasesForUser(
    userId: string,
    status: PurchaseStatusFilter | undefined,
    page = 1,
    limit = 20,
  ) {
    const filter: Record<string, unknown> = { buyer: userId };
    if (status) {
      filter.status = TransactionsService.PURCHASE_STATUS_MAP[status];
    }

    const [results, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .populate('buyer', PARTY_POPULATE_FIELDS)
        .populate('seller', PARTY_POPULATE_FIELDS)
        .populate('listing', LISTING_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.transactionModel.countDocuments(filter),
    ]);

    return {
      results: results.map((t) => this.toResponseShape(t, userId)),
      total,
      page,
      limit,
    };
  }

  // `statuses` (plural) so AdminService's single `status` param (grouped/friendly or exact — see AdminListTransactionsDto) can pass either one status or a grouped set (e.g. "active") through the same query path.
  async adminList(
    page: number,
    limit: number,
    statuses?: TransactionStatus[],
    dateRange: DateRangeDto = {},
  ) {
    const filter = {
      ...(statuses && statuses.length ? { status: { $in: statuses } } : {}),
      ...buildDateRangeFilter(dateRange),
    };
    const [results, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .populate('buyer', PARTY_POPULATE_FIELDS)
        .populate('seller', PARTY_POPULATE_FIELDS)
        .populate('listing', LISTING_POPULATE_FIELDS)
        .populate('escrow', '_id status')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.transactionModel.countDocuments(filter),
    ]);
    return {
      results: results.map((t) => this.toAdminResponseShape(t)),
      total,
      page,
      limit,
    };
  }

  // Bulk CSV export — GET /admin/transactions/export, added 2026-09-15,
  // explicit instruction ("see how we did it for the listing"), same
  // convention as ListingsService.exportCsv(): unpaginated, same
  // status/date-range filter as the list, one flattened row per
  // transaction. Deliberately skips the per-row `refundInfo` lookup the
  // single-transaction export/detail view do — that's a query per refunded
  // row, fine for one detail view, an N+1 risk across a potentially large
  // unpaginated export.
  async exportTransactionsCsv(
    statuses?: TransactionStatus[],
    dateRange: DateRangeDto = {},
  ): Promise<string> {
    const filter = {
      ...(statuses && statuses.length ? { status: { $in: statuses } } : {}),
      ...buildDateRangeFilter(dateRange),
    };
    const transactions = await this.transactionModel
      .find(filter)
      .populate('buyer', PARTY_POPULATE_FIELDS)
      .populate('seller', PARTY_POPULATE_FIELDS)
      .populate('listing', LISTING_POPULATE_FIELDS)
      .populate('escrow', '_id status')
      .sort({ createdAt: -1 })
      .exec();

    const rows = transactions.map((t) => {
      const buyer = t.buyer as unknown as PopulatedParty | null;
      const seller = t.seller as unknown as PopulatedParty | null;
      const listing = t.listing as unknown as { title?: string } | null;
      const escrow = t.escrow as unknown as { status?: string } | null;
      return {
        id: t._id.toString(),
        reference: t.reference,
        status: t.status,
        disputeStatus:
          t.status === TransactionStatus.DISPUTED
            ? (t.disputeStatus ?? DisputeStatus.UNDER_INVESTIGATION)
            : (t.disputeStatus ?? ''),
        inspectionStatus: t.inspectionStatus,
        inspectionOutcome: t.inspectionOutcome,
        amount: t.amount,
        commissionAmount: t.commissionAmount ?? '',
        sellerPayoutAmount: t.sellerPayoutAmount ?? '',
        gatewayProcessingFee: t.gatewayProcessingFee ?? '',
        gateway: t.gateway,
        paymentMethod: t.paymentMethod,
        buyerName: buyer?.name ?? '',
        buyerEmail: buyer?.email ?? '',
        sellerName: seller?.name ?? '',
        sellerEmail: seller?.email ?? '',
        listingTitle: listing?.title ?? '',
        escrowStatus: escrow?.status ?? '',
        createdAt: (t as unknown as { createdAt: Date }).createdAt,
        updatedAt: (t as unknown as { updatedAt: Date }).updatedAt,
      };
    });

    return toCsv(rows, [
      'id',
      'reference',
      'status',
      'disputeStatus',
      'inspectionStatus',
      'inspectionOutcome',
      'amount',
      'commissionAmount',
      'sellerPayoutAmount',
      'gatewayProcessingFee',
      'gateway',
      'paymentMethod',
      'buyerName',
      'buyerEmail',
      'sellerName',
      'sellerEmail',
      'listingTitle',
      'escrowStatus',
      'createdAt',
      'updatedAt',
    ]);
  }

  // Rich single-transaction admin view, by id or reference — this app has no
  // separate "slug" concept for a Transaction, its human-facing TXN-YYYY-#####
  // reference already fills that role, same as Listings' slug. Replaces the
  // old unused adminFindById() — 2026-09-15, explicit instruction. Scoped
  // entirely to this one endpoint: none of the extra populate/derived fields
  // here touch adminList() or the user-facing findForUserDisplay()/toResponseShape().
  async adminFindByIdOrReference(idOrReference: string) {
    const filter = isValidObjectId(idOrReference)
      ? { _id: idOrReference }
      : { reference: idOrReference };

    const transaction = await this.transactionModel
      .findOne(filter)
      .populate('buyer', PARTY_POPULATE_FIELDS)
      .populate('seller', PARTY_POPULATE_FIELDS)
      .populate({
        path: 'listing',
        select: ADMIN_DETAIL_LISTING_FIELDS,
        populate: { path: 'category', select: 'title' },
      })
      .populate('escrow', '_id status slug createdAt amount')
      .exec();

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const transactionId = transaction._id.toString();
    const buyerParty = transaction.buyer as unknown as PopulatedParty | null;
    const sellerParty = transaction.seller as unknown as PopulatedParty | null;
    const buyerId = buyerParty?._id?.toString();
    const sellerId = sellerParty?._id?.toString();

    const [activityLog, notifications, transactionNotes, buyerSettings] =
      await Promise.all([
        this.auditLogService.findAdminTimelineForEntity(
          'transaction',
          transactionId,
          { buyerId, sellerId },
        ),
        this.notificationsService.findForTransaction(transactionId),
        this.findNotesForTransaction(transactionId),
        buyerId
          ? this.notificationSettingsService.findRawForUser(buyerId)
          : Promise.resolve(null),
      ]);

    const shaped = this.toAdminResponseShape(transaction);
    shaped.listing = this.shapeAdminListingDetail(shaped.listing);
    shaped.activityLog = activityLog;
    shaped.communicationLog = this.buildCommunicationLog(
      notifications,
      transaction,
    );
    shaped.transactionNotes = transactionNotes;
    // Null when the buyer has inspectionReminders off (nothing could ever
    // have been delivered, so nothing meaningful to count) — explicit
    // instruction, 2026-09-15. A never-configured buyer (no settings
    // document at all) falls back to the schema's own default (true) rather
    // than being treated as off — findRawForUser() is a plain findOne with
    // no upsert, so it can't apply Mongoose's setDefaultsOnInsert for us.
    const inspectionRemindersOn = buyerSettings
      ? buyerSettings.inspectionReminders
      : true;
    shaped.inspectionReminderCount = inspectionRemindersOn
      ? transaction.inspectionReminderCount
      : null;
    shaped.insights = this.buildTransactionInsights(transaction);
    // Replica of insights.currentStage at the top level — explicit
    // instruction, 2026-09-15.
    shaped.currentStage = (
      shaped.insights as { currentStage: string }
    ).currentStage;

    // A dispute resolved via refund (adminRefund()/adminDelistAndRefund())
    // now stays at status DISPUTED, with disputeStatus carrying the REFUNDED
    // outcome instead — see both methods below — so this gate has to check
    // both shapes, not just the plain (non-disputed) REFUNDED status.
    if (
      transaction.status === TransactionStatus.REFUNDED ||
      (transaction.status === TransactionStatus.DISPUTED &&
        transaction.disputeStatus === DisputeStatus.REFUNDED)
    ) {
      shaped.refundInfo = await this.getRefundInfo(transactionId, buyerId);
    }
    if (transaction.status === TransactionStatus.COMPLETED) {
      shaped.payoutInfo = await this.getPayoutInfo(transactionId, buyerId);
    }
    if (transaction.status === TransactionStatus.DISPUTED) {
      shaped.disputeInfo = await this.getDisputeInfo(transactionId);
    }

    return shaped;
  }

  // Admin escrow detail — GET /admin/escrows/:idOrSlug. Mirrors the
  // transaction detail's shape almost entirely (listing/seller/buyer/
  // activityLog/transactionNotes/disputeInfo/refundInfo all reused verbatim
  // from adminFindByIdOrReference() above, since an Escrow is 1:1 with the
  // Transaction it was created from — there's nothing about buyer/seller/
  // listing/history that differs between the two views), then layers
  // escrow-specific money/timing fields on top. Lives here (not on
  // EscrowService) because EscrowService can't inject TransactionsService
  // back without a module cycle (TransactionsModule already imports
  // EscrowModule) — this direction already exists, so building the rich
  // shape here and having EscrowService only do the raw id-or-slug lookup
  // (findRawByIdOrSlug()) avoids needing forwardRef() at all. Exposed via
  // AdminController/AdminService (src/admin/), the same home
  // GET /admin/transactions/:idOrRef already lives in — not
  // AdminEscrowController, for the same DI-direction reason. 2026-09-18,
  // explicit instruction ("mirror pattern from transaction details").
  async adminFindEscrowDetail(idOrSlug: string) {
    const escrow = await this.escrowService.findRawByIdOrSlug(idOrSlug);
    const escrowCreatedAt = (escrow as unknown as { createdAt: Date })
      .createdAt;
    const escrowUpdatedAt = (escrow as unknown as { updatedAt: Date })
      .updatedAt;

    const shaped = await this.adminFindByIdOrReference(
      escrow.transaction.toString(),
    );

    const amount = shaped.amount as number;
    const commissionPercentage = shaped.commissionPercentage as number;
    const gatewayProcessingFee = (shaped.gatewayProcessingFee as number) ?? 0;
    const storedCommissionAmount = shaped.commissionAmount as
      number | undefined;
    const storedSellerPayoutAmount = shaped.sellerPayoutAmount as
      number | undefined;

    // Same fallback shape EscrowService.shapeEscrowRow() already uses for
    // the list view — a still-held escrow has no commissionAmount/
    // sellerPayoutAmount snapshotted yet (both are only computed at actual
    // release), so this projects what they'd be from the still-live
    // commissionPercentage setting until the real values land.
    const platformCommission =
      storedCommissionAmount ??
      Math.round(((amount * commissionPercentage) / 100) * 100) / 100;
    const sellerReceivable =
      storedSellerPayoutAmount ??
      Math.round((amount - platformCommission) * 100) / 100;

    const isEscrowOngoing =
      escrow.status === EscrowStatus.HELD ||
      escrow.status === EscrowStatus.FROZEN;
    // holdingDuration — my proposed design, as asked. Start is unambiguous
    // (escrow.createdAt, the moment money entered holding). End is "now"
    // while still held/frozen, or escrow.updatedAt once it's left holding —
    // updatedAt is reliable here specifically because status is the *only*
    // thing that ever changes on an Escrow document after creation
    // (updateStatusForTransaction() is its one write path), so the instant
    // it flips to a terminal status is captured synchronously and exactly.
    // Deliberately NOT the Payout/Refund's own completedAt/refundedAt —
    // those are frequently still unset at this exact moment (Paystack's
    // transfer/refund calls almost always come back "pending", only
    // confirmed later by the 15-minute reconciliation sweep — see the
    // Payout/Refund schemas), which would make holdingDuration
    // intermittently uncomputable right after a release/refund. That more
    // precise, sometimes-absent timestamp is still surfaced separately, in
    // settlementDetails.actualReleaseDate below, for whoever wants it.
    const holdingEndMoment = isEscrowOngoing ? new Date() : escrowUpdatedAt;
    const holdingDuration = formatDuration(
      holdingEndMoment.getTime() - escrowCreatedAt.getTime(),
    );

    const insights = {
      amountHeld: isEscrowOngoing ? escrow.amount : 0,
      platformCommission,
      sellerReceivable,
      holdingDuration,
      currentStage: shaped.currentStage,
    };

    const platformEarning = {
      platformFee: platformCommission,
      processingFee: gatewayProcessingFee,
      // Literally the same value as platformFee — explicit instruction.
      totalEarned: platformCommission,
    };

    const listing = shaped.listing as { price?: number } | null;
    const refundInfo = shaped.refundInfo as { amount?: number } | undefined;

    let settlementDetails: Record<string, unknown> | null = null;
    // "Settlement" specifically means the payout-to-seller leg — a refund
    // (money back to the buyer) is already covered by refundInfo above,
    // reused as-is from the transaction shape. Only RELEASED ever has a
    // real Payout row to show; HELD/FROZEN never do (nothing's moved yet),
    // matching the literal ask ("not held or frozen").
    if (escrow.status === EscrowStatus.RELEASED) {
      const payout = await this.payoutModel
        .findOne({ transaction: escrow.transaction })
        .sort({ createdAt: -1 })
        .exec();
      if (payout) {
        const buyerId = (shaped.buyer as { id?: string } | null)?.id;
        const triggeredByType: 'user' | 'admin' =
          payout.triggeredBy.toString() === buyerId ? 'user' : 'admin';
        const [bankName, initiatedBy] = await Promise.all([
          payout.payoutBankCode
            ? this.bankAccountsService.getBankNameByCode(payout.payoutBankCode)
            : Promise.resolve(undefined),
          this.resolveTriggeredBy(triggeredByType, payout.triggeredBy, buyerId),
        ]);
        settlementDetails = {
          settlementStatus: payout.status,
          actualReleaseDate: payout.completedAt ?? null,
          settlementReference: payout.reference,
          settlementBatch: payout.slug,
          bankName: bankName ?? null,
          maskedBankAccount: payout.payoutAccountNumber
            ? this.bankAccountsService.maskAccountNumber(
                payout.payoutAccountNumber,
              )
            : null,
          settlementAmount: payout.amount,
          settlementInitiatedBy: initiatedBy,
          // No separate "who marked it complete" actor exists in this app
          // beyond the automatic reconciliation sweep — a genuinely instant
          // Paystack success (rare) is indistinguishable from the sweep
          // confirming it later, so both read as system-completed.
          // Judgment call, flagged.
          settlementCompletedBy:
            payout.status === PayoutStatus.SUCCESS
              ? 'System (Automated)'
              : null,
          settlementTime: payout.completedAt
            ? payout.completedAt.toISOString().slice(11, 19)
            : null,
        };
      }
    }

    const netSettlement = settlementDetails
      ? (settlementDetails.settlementAmount as number)
      : sellerReceivable;

    const financialBreakdown = {
      itemPrice: listing?.price ?? amount,
      platformFeePercentage: commissionPercentage,
      // No dedicated stored percentage for the gateway charge — only the
      // Naira amount (gatewayProcessingFee) is stored anywhere. Derived
      // here instead of a stored config value. Judgment call, flagged.
      processingFeePercentage:
        amount > 0
          ? Math.round((gatewayProcessingFee / amount) * 10000) / 100
          : 0,
      totalPaidByBuyer: Math.round((amount + gatewayProcessingFee) * 100) / 100,
      sellerReceivable,
      refundAmount: refundInfo?.amount ?? null,
      netSettlement,
    };

    const settings = await this.settingsService.get();
    const paymentDetails = {
      paymentReference: shaped.reference,
      paymentGateway: shaped.gateway,
      paymentMethod: shaped.paymentMethod,
      // The real transaction status, not a fabricated "Captured"-style
      // label — this app doesn't track a payment-gateway status distinct
      // from the transaction's own. Judgment call, flagged.
      paymentStatus: shaped.status,
      currency: settings.defaultCurrency,
      paymentDate: escrowCreatedAt.toISOString().slice(0, 10),
      paymentTime: escrowCreatedAt.toISOString().slice(11, 19),
    };

    return {
      id: escrow._id.toString(),
      slug: escrow.slug,
      status: escrow.status,
      amount: escrow.amount,
      createdAt: escrowCreatedAt,
      updatedAt: escrowUpdatedAt,
      transaction: {
        id: escrow.transaction.toString(),
        reference: shaped.reference,
        status: shaped.status,
      },
      listing: shaped.listing,
      seller: shaped.seller,
      buyer: shaped.buyer,
      activityLog: shaped.activityLog,
      transactionNotes: shaped.transactionNotes,
      disputeInfo: shaped.disputeInfo ?? null,
      refundInfo: shaped.refundInfo ?? null,
      insights,
      platformEarning,
      financialBreakdown,
      paymentDetails,
      settlementDetails,
    };
  }

  // Listing.specs.brand flattened to a top-level `brand` on the response,
  // matching how CreateListingDto already treats brand as flat even though
  // the schema stores it nested — only this one detail endpoint's shape,
  // not the schema itself.
  private shapeAdminListingDetail(listing: unknown) {
    if (!listing || typeof listing !== 'object') {
      return listing;
    }
    const obj = { ...(listing as Record<string, unknown>) };
    const specs = obj.specs as { brand?: string } | undefined;
    obj.brand = specs?.brand;
    delete obj.specs;
    return obj;
  }

  // Every real (status: sent) push/email attempt ever made for this
  // transaction, one row per recipient per channel — buyer and seller are
  // always notified via two separate notify() calls with often-different
  // wording, so this deliberately never collapses them into one "both" row
  // (explicit instruction, 2026-09-15). Failed/skipped attempts are omitted —
  // this is a log of what was actually communicated, not a delivery-debug view.
  private buildCommunicationLog(
    notifications: NotificationDocument[],
    transaction: TransactionDocument,
  ) {
    const buyerParty = transaction.buyer as unknown as PopulatedParty | null;
    const sellerParty = transaction.seller as unknown as PopulatedParty | null;
    const buyerId = buyerParty?._id?.toString();
    const sellerId = sellerParty?._id?.toString();

    const log: Array<{
      channel: 'push' | 'email';
      recipient: 'buyer' | 'seller' | 'unknown';
      title: string;
      body: string;
      sentAt: Date;
    }> = [];

    for (const notification of notifications) {
      const recipientId = notification.recipient.toString();
      const recipient =
        recipientId === buyerId
          ? 'buyer'
          : recipientId === sellerId
            ? 'seller'
            : 'unknown';

      (['push', 'email'] as const).forEach((channel) => {
        if (
          notification.channels?.[channel]?.status ===
          NotificationChannelStatus.SENT
        ) {
          log.push({
            channel,
            recipient,
            title: notification.title,
            body: notification.body,
            sentAt: notification.createdAt,
          });
        }
      });
    }

    return log;
  }

  // transactionDuration/currentStage are both derived, not stored.
  // currentStage judgment call, flagged: "payment secured" and "seller
  // notified" happen synchronously in the same webhook call (see
  // handlePaystackWebhook()) — there's no backend state where one is true
  // and the other isn't, so both collapse into "Inspection" the moment
  // escrow_active is reached, since that's the first state anyone could
  // ever actually observe a transaction resting in. A 5th stage was
  // mentioned as still to be defined — not implemented, only 3 of the 5
  // named stages are reachable from current transaction state today.
  private buildTransactionInsights(transaction: TransactionDocument) {
    const escrow = transaction.escrow as unknown as { amount?: number } | null;
    const createdAt = (transaction as unknown as { createdAt: Date }).createdAt;
    const updatedAt = (transaction as unknown as { updatedAt: Date }).updatedAt;
    const isTerminal = [
      TransactionStatus.COMPLETED,
      TransactionStatus.REFUNDED,
      TransactionStatus.CANCELLED,
      TransactionStatus.DISPUTED,
    ].includes(transaction.status);
    const endMoment = isTerminal ? updatedAt : new Date();
    const durationMs = endMoment.getTime() - createdAt.getTime();

    return {
      transactionAmount: transaction.amount,
      escrowAmount: escrow?.amount ?? 0,
      transactionDuration: formatDuration(durationMs),
      currentStage: this.computeCurrentStage(transaction),
    };
  }

  // The 5th ("dynamic") stage, resolved 2026-09-15, explicit instruction:
  // completed -> Resolved, refunded -> Refund Processed, disputed -> Under
  // Dispute. CANCELLED isn't one of the named outcomes — kept at the prior
  // catch-all ("Buyer's decision") as a judgment call, flagged.
  private computeCurrentStage(transaction: TransactionDocument): string {
    switch (transaction.status) {
      case TransactionStatus.PENDING_PAYMENT:
        return 'Awaiting payment';
      case TransactionStatus.COMPLETED:
        return 'Resolved';
      case TransactionStatus.REFUNDED:
        return 'Refund Processed';
      case TransactionStatus.DISPUTED:
        return 'Under Dispute';
      case TransactionStatus.CANCELLED:
        return "Buyer's decision";
      case TransactionStatus.REPORTED:
        return 'Reported';
      default:
        return 'Inspection';
    }
  }

  // Buyer-only, one-time, gated by explicit instruction to inspectionPeriodEnded
  // still being FALSE — a proactive nudge while the window is still open, not
  // a post-expiry one (a lapsed window auto-refunds via sweepEndedInspectionPeriods()
  // before an admin could ever act on it). Increments inspectionReminderCount
  // regardless of what the buyer's own inspectionReminders setting allows —
  // notify() itself silently no-ops the actual push/email if it's off, same
  // as everywhere else notify() is gated.
  async sendInspectionReminder(
    transactionId: string,
    adminId: string,
    reminderType: InspectionReminderType,
    channel: 'push' | 'email',
    message?: string,
  ) {
    const transaction = await this.findRaw(transactionId);
    if (transaction.status !== TransactionStatus.ESCROW_ACTIVE) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — a reminder can't be sent`,
      );
    }
    if (transaction.inspectionStatus !== InspectionStatus.AWAITING) {
      throw new BadRequestException(
        'Inspection has already been resolved for this transaction',
      );
    }
    if (transaction.inspectionPeriodEnded) {
      throw new BadRequestException(
        'The inspection window has already ended for this transaction',
      );
    }

    const { title, body } = this.buildReminderContent(reminderType, message);

    transaction.inspectionReminderCount =
      (transaction.inspectionReminderCount ?? 0) + 1;
    await transaction.save();

    await this.audit(
      transactionId,
      'admin_sent_inspection_reminder',
      adminId,
      transaction.inspectionStatus,
      transaction.inspectionStatus,
      {
        reminderCount: transaction.inspectionReminderCount,
        reminderType,
        channel,
      },
    );

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.buyer.toString(),
      type: 'inspection_reminder',
      title,
      body,
      data: { transactionId },
      forceChannels: [channel],
    });

    return { inspectionReminderCount: transaction.inspectionReminderCount };
  }

  // reminderType picks which of 3 predefined messages to send — 2026-09-15,
  // explicit instruction. CUSTOM_MESSAGE's `message` is required by the DTO
  // (SendInspectionReminderDto) whenever that type is selected.
  private buildReminderContent(
    reminderType: InspectionReminderType,
    message?: string,
  ): { title: string; body: string } {
    switch (reminderType) {
      case InspectionReminderType.DEADLINE_WARNING:
        return {
          title: 'Inspection deadline approaching',
          body: 'Your inspection window is closing soon — confirm receipt or reach out to support before it ends.',
        };
      case InspectionReminderType.CUSTOM_MESSAGE:
        return { title: 'Message from Declut', body: message! };
      case InspectionReminderType.INSPECTION_REMINDER:
      default:
        return {
          title: 'Inspection reminder',
          body: "Don't forget to inspect your item and confirm receipt before your inspection window ends.",
        };
    }
  }

  // Admin-only (gated at the controller). transactionId/description come
  // from the request body, writtenBy always from the caller's own token.
  async createNote(
    transactionId: string,
    adminId: string,
    description: string,
  ) {
    const transaction = await this.findRaw(transactionId);

    const note = await this.transactionNoteModel.create({
      transaction: transaction._id,
      writtenBy: adminId,
      description,
    });

    await this.audit(
      transactionId,
      'transaction_note_added',
      adminId,
      transaction.status,
      transaction.status,
      { noteId: note._id.toString() },
    );

    await note.populate({
      path: 'writtenBy',
      select: 'name role',
      populate: { path: 'role', select: 'name' },
    });

    return this.shapeNote(note);
  }

  // Admin-only (gated at the controller). Only description is editable —
  // transaction/writtenBy are fixed at creation and can never change, so
  // neither is accepted here at all (see UpdateTransactionNoteDto). Object-
  // level ownership: only the admin who wrote the note can edit it — an
  // initial pass allowed any admin with transactions/write, corrected the
  // same day, explicit instruction ("only the admin who wrote it can edit
  // or delete"). 403, not 404 — same "the resource exists, you're just not
  // allowed to touch it" posture as every other ownership check in this app.
  async updateNote(noteId: string, adminId: string, description: string) {
    const note = await this.findRawNote(noteId);
    if (note.writtenBy.toString() !== adminId) {
      throw new ForbiddenException(
        'Only the admin who wrote this note can edit it',
      );
    }
    const oldDescription = note.description;
    note.description = description;
    await note.save();

    await this.audit(
      note.transaction.toString(),
      'transaction_note_updated',
      adminId,
      oldDescription,
      description,
      { noteId },
    );

    await note.populate({
      path: 'writtenBy',
      select: 'name role',
      populate: { path: 'role', select: 'name' },
    });
    return this.shapeNote(note);
  }

  // Hard delete — a note has no downstream reference the way Listings/
  // Transactions do (nothing stores a noteId anywhere else). Same
  // writtenBy-only ownership check as updateNote() above.
  async removeNote(noteId: string, adminId: string): Promise<void> {
    const note = await this.findRawNote(noteId);
    if (note.writtenBy.toString() !== adminId) {
      throw new ForbiddenException(
        'Only the admin who wrote this note can remove it',
      );
    }
    const transactionId = note.transaction.toString();
    const description = note.description;
    await note.deleteOne();

    await this.audit(
      transactionId,
      'transaction_note_removed',
      adminId,
      description,
      'deleted',
      { noteId },
    );
  }

  private async findRawNote(id: string): Promise<TransactionNoteDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Transaction note not found');
    }
    const note = await this.transactionNoteModel.findById(id);
    if (!note) {
      throw new NotFoundException('Transaction note not found');
    }
    return note;
  }

  private async findNotesForTransaction(transactionId: string) {
    const notes = await this.transactionNoteModel
      .find({ transaction: transactionId })
      .sort({ createdAt: -1 })
      .populate({
        path: 'writtenBy',
        select: 'name role',
        populate: { path: 'role', select: 'name' },
      })
      .exec();
    return notes.map((note) => this.shapeNote(note));
  }

  private shapeNote(note: TransactionNoteDocument) {
    const writtenBy = note.writtenBy as unknown as {
      _id: Types.ObjectId;
      name: string;
      role?: { name: string } | null;
    } | null;
    return {
      id: note._id.toString(),
      description: note.description,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      writtenBy: writtenBy
        ? {
            id: writtenBy._id.toString(),
            name: writtenBy.name,
            role: writtenBy.role?.name,
          }
        : null,
    };
  }

  // Wraps PaystackService.refund() to guarantee a Refund audit record either
  // way — success or failure — before propagating any error, so a failed
  // refund attempt is still visible for the admin, not silently missing.
  // Added 2026-09-15, explicit instruction — only called from the two
  // requester-triggered refund flows (buyer's own cancelPurchaseWithRefund(),
  // admin's adminRefund()); the system-triggered inspection-expiry
  // auto-refund deliberately doesn't create a Refund record, since it never
  // results in TransactionStatus.REFUNDED (see autoRefundExpiredInspection()).
  // Paystack's own response status (almost always 'pending') drives the
  // Refund row's own status, not an assumption of success — see
  // reconcilePendingRefunds() below for how a pending row is later
  // corrected. A thrown call is recorded as FAILED outright, same as before.
  private async refundAndRecord(params: {
    transactionId: string;
    buyerId: string;
    reference: string;
    amount: number;
    amountKobo?: number;
    reason?: string;
    triggeredByType: RefundTriggeredByType;
    triggeredBy?: string;
  }): Promise<void> {
    let result: { status: string; refundId: string } | undefined;
    try {
      result = await this.paystackService.refund(
        params.reference,
        params.amountKobo,
      );
    } catch (err) {
      await this.createRefundRecord({ ...params, paystackStatus: undefined });
      throw err;
    }
    await this.createRefundRecord({
      ...params,
      paystackStatus: result.status,
      refundCode: result.refundId,
    });
  }

  // payoutAccountNumber/payoutBankCode are best-effort context from the
  // buyer's own BankAccount, if one exists — Paystack's refund reverses to
  // the original payment source, not a chosen bank account, so these
  // describe the buyer's account on file, not necessarily where the refund
  // actually landed. paystackStatus undefined means the call itself threw —
  // a hard failure, not a pending one.
  private async createRefundRecord(params: {
    transactionId: string;
    buyerId: string;
    amount: number;
    reason?: string;
    triggeredByType: RefundTriggeredByType;
    triggeredBy?: string;
    reference: string;
    paystackStatus?: string;
    refundCode?: string;
  }): Promise<void> {
    const [bankAccount, slug] = await Promise.all([
      this.bankAccountsService.findRawByUser(params.buyerId),
      this.counterService.nextSlug('refund', 'RFD', 4),
    ]);
    const status = !params.paystackStatus
      ? RefundStatus.FAILED
      : params.paystackStatus === 'processed'
        ? RefundStatus.PROCESSED
        : RefundStatus.PENDING;
    await this.refundModel.create({
      transaction: params.transactionId,
      user: params.buyerId,
      amount: params.amount,
      reason: params.reason,
      status,
      triggeredByType: params.triggeredByType,
      triggeredBy: params.triggeredBy,
      payoutAccountNumber: bankAccount?.accountNumber,
      payoutBankCode: bankAccount?.bankCode,
      refundedAt: status === RefundStatus.PROCESSED ? new Date() : undefined,
      slug,
      reference: params.reference,
      refundCode: params.refundCode,
    });
  }

  // Resolves a polymorphic triggeredBy (Refund.triggeredByType/triggeredBy,
  // Payout.triggeredByType/triggeredBy) into a display-ready shape —
  // {id, name, slug, role, rolePlayed}. No Mongoose `ref` exists on either
  // field (it can point at User or Admin), so this can't lean on
  // .populate() the way TransactionNote.writtenBy does; it queries
  // manually instead. buyerId/sellerId (already on hand at every call site)
  // are what decide rolePlayed for a User — 'buyer' or 'seller' — without a
  // second query. 2026-09-17, explicit instruction.
  private async resolveTriggeredBy(
    type: 'user' | 'admin' | 'system',
    id: Types.ObjectId | undefined,
    buyerId?: string,
  ): Promise<{
    id: string | null;
    name: string | null;
    slug: string | null;
    role: string | null;
    rolePlayed: 'buyer' | 'seller' | 'admin' | 'system';
  }> {
    if (type === 'system' || !id) {
      return {
        id: null,
        name: 'System',
        slug: null,
        role: null,
        rolePlayed: 'system',
      };
    }
    if (type === 'admin') {
      const admin = await this.adminModel
        .findById(id)
        .select('name slug role')
        .populate({ path: 'role', select: 'name' })
        .exec();
      const role = admin?.role as unknown as { name?: string } | null;
      return {
        id: id.toString(),
        name: admin?.name ?? null,
        slug: admin?.slug ?? null,
        role: role?.name ?? null,
        rolePlayed: 'admin',
      };
    }
    // 'user'
    const user = await this.usersService.findById(id.toString());
    const rolePlayed = id.toString() === buyerId ? 'buyer' : 'seller';
    return {
      id: id.toString(),
      name: user?.name ?? null,
      slug: user?.slug ?? null,
      role: null,
      rolePlayed,
    };
  }

  // Backs the admin transaction detail's `refundInfo` — shown for a
  // REFUNDED transaction, or a DISPUTED one whose disputeStatus is REFUNDED
  // (see adminFindByIdOrReference()). Picks the most recent refund row
  // regardless of status (not just 'processed') — showing a still-pending
  // refund is the whole point of tracking this now, rather than only ever
  // showing a finished one.
  private async getRefundInfo(transactionId: string, buyerId?: string) {
    const refund = await this.refundModel
      .findOne({ transaction: transactionId })
      .sort({ createdAt: -1 })
      .exec();
    if (!refund) {
      return null;
    }
    return {
      id: refund._id.toString(),
      slug: refund.slug,
      amount: refund.amount,
      reason: refund.reason,
      status: refund.status,
      triggeredBy: await this.resolveTriggeredBy(
        refund.triggeredByType,
        refund.triggeredBy,
        buyerId,
      ),
      payoutAccountNumber: refund.payoutAccountNumber,
      payoutBankCode: refund.payoutBankCode,
      refundedAt: refund.refundedAt,
      reference: refund.reference,
      refundCode: refund.refundCode,
      createdAt: refund.createdAt,
    };
  }

  // Sibling of getRefundInfo(), for the release-to-seller side — only ever
  // called when transaction.status === COMPLETED. Same "most recent row,
  // whatever status it's currently at" shape.
  private async getPayoutInfo(transactionId: string, buyerId?: string) {
    const payout = await this.payoutModel
      .findOne({ transaction: transactionId })
      .sort({ createdAt: -1 })
      .exec();
    if (!payout) {
      return null;
    }
    // Payout has no stored triggeredByType (only 'user'/buyer or 'admin' are
    // ever possible, unlike Refund's three) — inferred here by comparing
    // against the transaction's own buyer id instead.
    const triggeredByType =
      payout.triggeredBy.toString() === buyerId ? 'user' : 'admin';
    return {
      id: payout._id.toString(),
      slug: payout.slug,
      amount: payout.amount,
      status: payout.status,
      triggeredBy: await this.resolveTriggeredBy(
        triggeredByType,
        payout.triggeredBy,
        buyerId,
      ),
      payoutAccountNumber: payout.payoutAccountNumber,
      payoutBankCode: payout.payoutBankCode,
      reference: payout.reference,
      transferCode: payout.transferCode,
      completedAt: payout.completedAt,
      createdAt: payout.createdAt,
    };
  }

  // Backs the admin transaction detail's `disputeInfo` — only ever called
  // when transaction.status === DISPUTED. Pulls from both the Dispute (the
  // seller's own submission) and the Report it points at (status + the
  // buyer's original reason) — a Dispute has no `listing`/status of its
  // own, see the Disputes Module docs. Returns null for the pre-existing
  // payment-race-loss auto-dispute path, which has no Dispute document at
  // all (only a seller-raised dispute does). 2026-09-17, explicit
  // instruction.
  private async getDisputeInfo(transactionId: string) {
    const dispute = await this.disputeModel
      .findOne({ transaction: transactionId })
      .populate({ path: 'report', select: 'slug status reason' })
      .exec();
    if (!dispute) {
      return null;
    }
    const report = dispute.report as unknown as {
      slug?: string;
      status?: string;
      reason?: string;
    } | null;
    return {
      createdAt: dispute.createdAt,
      // The report's own moderation status (new/investigating/resolved/
      // dismissed) — not the transaction's own status.
      status: report?.status ?? null,
      slug: report?.slug ?? null,
      buyerStatement: report?.reason ?? null,
      sellerStatement: dispute.disputeClaim,
      evidenceImages: dispute.evidenceImages,
      evidenceVideo: dispute.evidenceVideo,
    };
  }

  // Safety-net reconciliation — runs independently of any webhook (none is
  // wired for transfer.*/refund.* events yet, see the chat discussion this
  // was built from). Checks every still-pending Payout/Refund row directly
  // against Paystack and corrects its status once Paystack has a final
  // answer. A row that's still pending on Paystack's side is left alone and
  // picked up again on the next run.
  @Cron('*/15 * * * *')
  async reconcilePendingPayoutsAndRefunds(): Promise<void> {
    await Promise.all([
      this.reconcilePendingPayouts(),
      this.reconcilePendingRefunds(),
    ]);
  }

  private async reconcilePendingPayouts(): Promise<void> {
    const pending = await this.payoutModel.find({
      status: PayoutStatus.PENDING,
    });
    for (const payout of pending) {
      try {
        const result = await this.paystackService.getTransferStatus(
          payout.transferCode || payout.reference,
        );
        if (result.status === 'success') {
          payout.status = PayoutStatus.SUCCESS;
          payout.completedAt = new Date();
          await payout.save();
          await this.audit(
            payout.transaction.toString(),
            'payout_reconciled_success',
            'system',
            PayoutStatus.PENDING,
            PayoutStatus.SUCCESS,
          );
        } else if (result.status === 'failed' || result.status === 'reversed') {
          payout.status = PayoutStatus.FAILED;
          await payout.save();
          this.logger.error(
            `[reconcile] payout=${payout._id.toString()} transaction=${payout.transaction.toString()} FAILED on Paystack's side — needs admin attention`,
          );
          await this.audit(
            payout.transaction.toString(),
            'payout_reconciled_failed',
            'system',
            PayoutStatus.PENDING,
            PayoutStatus.FAILED,
          );
        }
        // Anything else (still 'pending'/'otp' on Paystack's side) — leave as-is, retry next sweep.
      } catch (err) {
        this.logger.error(
          `[reconcile] failed to check payout=${payout._id.toString()} — will retry next sweep`,
          err as Error,
        );
      }
    }
  }

  private async reconcilePendingRefunds(): Promise<void> {
    const pending = await this.refundModel.find({
      status: RefundStatus.PENDING,
    });
    for (const refund of pending) {
      try {
        const result = await this.paystackService.getRefundStatus(
          refund.refundCode || refund.reference,
        );
        if (result.status === 'processed') {
          refund.status = RefundStatus.PROCESSED;
          refund.refundedAt = new Date();
          await refund.save();
          await this.audit(
            refund.transaction.toString(),
            'refund_reconciled_processed',
            'system',
            RefundStatus.PENDING,
            RefundStatus.PROCESSED,
          );
        } else if (
          result.status === 'failed' ||
          result.status === 'declined' ||
          result.status === 'reversed'
        ) {
          refund.status = RefundStatus.FAILED;
          await refund.save();
          this.logger.error(
            `[reconcile] refund=${refund._id.toString()} transaction=${refund.transaction.toString()} FAILED on Paystack's side — needs admin attention`,
          );
          await this.audit(
            refund.transaction.toString(),
            'refund_reconciled_failed',
            'system',
            RefundStatus.PENDING,
            RefundStatus.FAILED,
          );
        }
      } catch (err) {
        this.logger.error(
          `[reconcile] failed to check refund=${refund._id.toString()} — will retry next sweep`,
          err as Error,
        );
      }
    }
  }

  // Used by the admin Users detail view's "Insights" panel.
  async getUserTransactionInsights(userId: string): Promise<{
    sales: { total: number; completed: number };
    purchases: { total: number; amountSpent: number };
  }> {
    const uid = new Types.ObjectId(userId);
    const [salesRows, purchaseRows] = await Promise.all([
      this.transactionModel.aggregate<{
        _id: null;
        total: number;
        completed: number;
      }>([
        { $match: { seller: uid } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: {
                $cond: [
                  { $eq: ['$status', TransactionStatus.COMPLETED] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      this.transactionModel.aggregate<{
        _id: null;
        total: number;
        amountSpent: number;
      }>([
        { $match: { buyer: uid } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            amountSpent: {
              $sum: {
                $cond: [
                  { $eq: ['$status', TransactionStatus.COMPLETED] },
                  '$amount',
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    return {
      sales: {
        total: salesRows[0]?.total ?? 0,
        completed: salesRows[0]?.completed ?? 0,
      },
      purchases: {
        total: purchaseRows[0]?.total ?? 0,
        amountSpent: purchaseRows[0]?.amountSpent ?? 0,
      },
    };
  }

  // Used by the admin Users detail view's "recent transactions" panel.
  async getRecentForUser(
    userId: string,
    limit = 3,
  ): Promise<
    Array<{
      transactionId: string;
      role: 'buyer' | 'seller';
      direction: 'inflow' | 'outflow';
      amount: number;
      status: TransactionStatus;
      createdAt: Date;
    }>
  > {
    const transactions = await this.transactionModel
      .find({ $or: [{ buyer: userId }, { seller: userId }] })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    return transactions.map((t) => {
      const isBuyer = t.buyer.toString() === userId;
      return {
        transactionId: t._id.toString(),
        role: isBuyer ? 'buyer' : 'seller',
        direction: isBuyer ? 'outflow' : 'inflow',
        amount: t.amount,
        status: t.status,
        createdAt: (t as unknown as { createdAt: Date }).createdAt,
      };
    });
  }

  // Money moves automatically only on the unambiguous "correct code entered" case (confirmCode()) — everything else requires this explicit admin action, per CLAUDE.md's transaction state machine step 8.
  // Option 3 of the three admin dispute-resolution actions — side with the
  // seller, release the held money to them (taking the admin-configured
  // commission). Unchanged behavior except: now also records a Payout row
  // (triggeredByType 'admin' — adminRelease() never created one before
  // 2026-09-17) and closes the report behind the dispute, if any.
  async adminRelease(transactionId: string, adminId: string) {
    const transaction = await this.findRaw(transactionId);
    if (transaction.status !== TransactionStatus.DISPUTED) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — admin release only applies to disputed transactions`,
      );
    }

    const seller = await this.usersService.findById(
      transaction.seller.toString(),
    );
    if (!seller?.hasPayoutDetails) {
      throw new InternalServerErrorException(
        'Seller payout details are missing',
      );
    }
    const bankAccount = await this.bankAccountsService.findRawByUser(
      transaction.seller.toString(),
    );
    if (!bankAccount) {
      throw new InternalServerErrorException(
        'Seller payout details are missing',
      );
    }

    const rawCommission =
      (transaction.amount * transaction.commissionPercentage) / 100;
    const commissionAmount = Math.round(rawCommission * 100) / 100;
    const sellerPayoutAmount =
      Math.round((transaction.amount - commissionAmount) * 100) / 100;

    // Paystack call before the local write — same money-movement ordering rule as confirmCode()'s release path.
    const payoutReference = `declut_admin_release_${transaction._id.toString()}`;
    const transferResult = await this.paystackService.releaseToSeller({
      bankCode: bankAccount.bankCode,
      accountNumber: bankAccount.accountNumber,
      accountName: bankAccount.accountHolderName,
      amountKobo: Math.round(sellerPayoutAmount * 100),
      reference: payoutReference,
    });

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.COMPLETED;
    transaction.disputeStatus = DisputeStatus.RESOLVED;
    transaction.commissionAmount = commissionAmount;
    transaction.sellerPayoutAmount = sellerPayoutAmount;
    transaction.inspectionStatus = InspectionStatus.COMPLETED;
    transaction.inspectionOutcome = InspectionOutcome.ACCEPTED;
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.RELEASED,
    );
    await this.listingsService.markSold(transaction.listing.toString());

    await this.payoutModel.create({
      transaction: transaction._id,
      user: transaction.seller,
      amount: sellerPayoutAmount,
      status:
        transferResult.status === 'success'
          ? PayoutStatus.SUCCESS
          : PayoutStatus.PENDING,
      triggeredBy: adminId,
      payoutAccountNumber: bankAccount.accountNumber,
      payoutBankCode: bankAccount.bankCode,
      reference: payoutReference,
      transferCode: transferResult.transferCode,
      completedAt: transferResult.status === 'success' ? new Date() : undefined,
      slug: await this.counterService.nextSlug('payout', 'PYO', 4),
    });
    await this.closeReportIfDisputed(transactionId);

    await this.audit(
      transactionId,
      'admin_released',
      adminId,
      oldStatus,
      TransactionStatus.COMPLETED,
      { commissionAmount, sellerPayoutAmount },
    );

    await Promise.all([
      this.trustScoreService.recalculate(transaction.buyer.toString()),
      this.trustScoreService.recalculate(transaction.seller.toString()),
    ]);

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.seller.toString(),
      type: 'admin_released',
      title: 'Funds released',
      body: `An admin resolved your transaction — ₦${sellerPayoutAmount.toLocaleString()} has been sent to your account.`,
      data: { transactionId },
    });
    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.buyer.toString(),
      type: 'admin_released',
      title: 'Transaction resolved',
      body: 'An admin reviewed your transaction and released funds to the seller.',
      data: { transactionId },
    });

    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toAdminResponseShape(transaction);
  }

  // Shared by Option 1 (adminDelistAndRefund) and Option 2 (adminRefund)
  // below — both are a full refund to the buyer, and both leave
  // Transaction.status at DISPUTED rather than transitioning it to REFUNDED
  // (explicit instruction, 2026-09-17, a deliberate change from how every
  // other refund path in this app behaves) — only disputeStatus moves to
  // REFUNDED, a permanent marker of how the dispute concluded. Doesn't
  // touch the listing or the report — the two callers diverge there.
  private async resolveDisputeWithRefund(
    transaction: TransactionDocument,
    adminId: string,
    reason?: string,
  ): Promise<void> {
    await this.refundAndRecord({
      transactionId: transaction._id.toString(),
      buyerId: transaction.buyer.toString(),
      reference: transaction.reference,
      amount: transaction.amount,
      amountKobo: Math.round(transaction.amount * 100),
      reason,
      triggeredByType: 'admin',
      triggeredBy: adminId,
    });

    transaction.disputeStatus = DisputeStatus.REFUNDED;
    transaction.inspectionStatus = InspectionStatus.FAILED;
    transaction.inspectionOutcome = InspectionOutcome.DISPUTED;
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.REFUNDED,
    );
  }

  // Option 2 — refund the buyer in full; the listing stays up (reverts to
  // active if it wasn't already), no penalty against the seller. Reworked
  // 2026-09-17: transaction.status now stays DISPUTED (see
  // resolveDisputeWithRefund() above) instead of transitioning to REFUNDED.
  async adminRefund(transactionId: string, adminId: string, reason?: string) {
    const transaction = await this.findRaw(transactionId);
    if (transaction.status !== TransactionStatus.DISPUTED) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — admin refund only applies to disputed transactions`,
      );
    }

    // Paystack call before the local write — same ordering rule as everywhere else money moves in this module.
    await this.resolveDisputeWithRefund(transaction, adminId, reason);
    await this.listingsService.revertToActive(transaction.listing.toString());
    await this.closeReportIfDisputed(transactionId);

    await this.audit(
      transactionId,
      'admin_refunded',
      adminId,
      TransactionStatus.DISPUTED,
      TransactionStatus.DISPUTED,
      { reason, disputeStatus: DisputeStatus.REFUNDED },
    );

    await Promise.all([
      this.trustScoreService.recalculate(transaction.buyer.toString()),
      this.trustScoreService.recalculate(transaction.seller.toString()),
    ]);

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.buyer.toString(),
      type: 'admin_refunded',
      title: 'Transaction refunded',
      body: 'An admin reviewed your transaction and issued a refund.',
      data: { transactionId },
    });
    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.seller.toString(),
      type: 'admin_refunded',
      title: 'Please review your listing',
      body: "An admin refunded the buyer's report against your listing — please review and edit it before it's purchased again.",
      data: { transactionId },
    });

    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toAdminResponseShape(transaction);
  }

  // Option 1 — refund the buyer in full, delist the seller's listing, and
  // apply a policy strike against the seller's trust score. Added
  // 2026-09-17, explicit instruction. Same "transaction stays DISPUTED,
  // disputeStatus -> REFUNDED" shape as adminRefund() above — the two
  // differ only in what happens to the listing and the seller.
  async adminDelistAndRefund(
    transactionId: string,
    adminId: string,
    reason?: string,
  ) {
    const transaction = await this.findRaw(transactionId);
    if (transaction.status !== TransactionStatus.DISPUTED) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — this action only applies to disputed transactions`,
      );
    }

    await this.resolveDisputeWithRefund(transaction, adminId, reason);
    await this.listingsService.adminDelistFromDispute(
      transaction.listing.toString(),
      adminId,
    );
    await this.closeReportIfDisputed(transactionId);

    await this.audit(
      transactionId,
      'admin_delisted_and_refunded',
      adminId,
      TransactionStatus.DISPUTED,
      TransactionStatus.DISPUTED,
      { reason, disputeStatus: DisputeStatus.REFUNDED },
    );

    // Recalculate BEFORE the policy strike, not after — recalculate()
    // fully overwrites trustScore from the formula, which has no "policy
    // violation" input, so a strike applied first would just get discarded
    // the instant recalculate() runs.
    await Promise.all([
      this.trustScoreService.recalculate(transaction.buyer.toString()),
      this.trustScoreService.recalculate(transaction.seller.toString()),
    ]);
    await this.trustScoreService.applyPolicyStrike(
      transaction.seller.toString(),
    );

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: transaction.buyer.toString(),
      type: 'admin_refunded',
      title: 'Transaction refunded',
      body: 'An admin reviewed your transaction and issued a refund.',
      data: { transactionId },
    });
    // The seller's own delisting notification is sent by
    // ListingsService.adminDelistFromDispute() itself (listing_unlisted) —
    // not duplicated here.

    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toAdminResponseShape(transaction);
  }

  // Runs hourly. Watches escrow_active transactions still awaiting
  // inspection and, once the effective deadline passes
  // (inspectionExtensionEndDate if the buyer used their one-time extension,
  // otherwise the original inspectionDeadlineAt), automatically cancels and
  // refunds the buyer — explicit instruction, 2026-09-13, replacing the
  // earlier design where a lapsed deadline just flagged the transaction
  // STALLED for manual admin review. STALLED no longer exists as a status
  // at all (see TransactionStatus/adminRelease()/adminRefund() above) — a
  // failed Paystack refund attempt here is logged and simply retried on the
  // next hourly run (inspectionPeriodEnded is only committed once the
  // refund actually succeeds), there's no separate admin-review fallback.
  @Cron(CronExpression.EVERY_HOUR)
  async sweepEndedInspectionPeriods(): Promise<void> {
    const now = new Date();

    const candidates = await this.transactionModel.find({
      status: TransactionStatus.ESCROW_ACTIVE,
      inspectionStatus: InspectionStatus.AWAITING,
      inspectionPeriodEnded: false,
      $or: [
        { inspectionExtended: false, inspectionDeadlineAt: { $lte: now } },
        { inspectionExtended: true, inspectionExtensionEndDate: { $lte: now } },
      ],
    });

    let refunded = 0;
    for (const transaction of candidates) {
      try {
        await this.autoRefundExpiredInspection(transaction);
        refunded++;
      } catch (err) {
        this.logger.error(
          `[inspection-expired] auto-refund failed for transaction=${transaction._id.toString()} — will retry on the next sweep`,
          err as Error,
        );
      }
    }

    if (refunded > 0) {
      this.logger.log(
        `Auto-refunded ${refunded} transaction(s) whose inspection window expired`,
      );
    }
  }

  // Same fixed 10% fee as cancelPurchaseWithRefund() — the buyer simply
  // never confirmed receipt in time, Declut isn't refunding its own cut.
  // Transaction.status -> CANCELLED, not REFUNDED — explicit instruction:
  // the buyer never requested this, the system auto-cancelled it for lost
  // interest, so it's meant to read differently from a buyer-requested
  // refund even though money moves the same way. Paystack call before the
  // local write, same ordering rule as everywhere else in this module.
  private async autoRefundExpiredInspection(
    transaction: TransactionDocument,
  ): Promise<void> {
    const transactionId = transaction._id.toString();

    const rawFee = (transaction.amount * CANCELLATION_FEE_PERCENTAGE) / 100;
    const commissionAmount = Math.round(rawFee * 100) / 100;
    const refundAmount =
      Math.round((transaction.amount - commissionAmount) * 100) / 100;

    // Routed through refundAndRecord() (2026-09-16) so this auto-refund gets
    // its own Refund row too, triggeredByType 'system' — it didn't before,
    // explicit instruction to add it. refundAndRecord() rethrows on failure,
    // same as the direct paystackService.refund() call this replaces, so the
    // caller's try/catch (sweepEndedInspectionPeriods()) still retries on
    // the next hourly run.
    await this.refundAndRecord({
      transactionId,
      buyerId: transaction.buyer.toString(),
      reference: transaction.reference,
      amount: refundAmount,
      amountKobo: Math.round(refundAmount * 100),
      reason: 'Inspection window expired without buyer confirmation',
      triggeredByType: 'system',
    });

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.CANCELLED;
    transaction.inspectionStatus = InspectionStatus.FAILED;
    transaction.inspectionOutcome = InspectionOutcome.DISPUTED;
    transaction.commissionAmount = commissionAmount;
    transaction.inspectionPeriodEnded = true;
    await transaction.save();

    await this.escrowService.updateStatusForTransaction(
      transactionId,
      EscrowStatus.REFUNDED,
    );
    await this.listingsService.revertToActive(transaction.listing.toString());

    await this.audit(
      transactionId,
      'inspection_expired_auto_refunded',
      'system',
      oldStatus,
      TransactionStatus.CANCELLED,
      { commissionAmount, refundAmount },
    );

    await Promise.all([
      this.trustScoreService.recalculate(transaction.buyer.toString()),
      this.trustScoreService.recalculate(transaction.seller.toString()),
    ]);

    await Promise.all([
      this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.buyer.toString(),
        type: 'inspection_expired_refunded',
        title: 'Inspection window expired',
        body: `You didn't confirm receipt in time, so the purchase was cancelled — ₦${refundAmount.toLocaleString()} has been refunded to you.`,
        data: { transactionId },
      }),
      this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: transaction.seller.toString(),
        type: 'inspection_expired_refunded',
        title: 'Inspection window expired',
        body: 'The buyer never confirmed receipt within the inspection window — the sale was automatically cancelled and refunded.',
        data: { transactionId },
      }),
    ]);
  }

  // Runs hourly. An abandoned checkout (WebView closed without paying, app killed mid-flow)
  // is cancelled client-side on close (see the app's checkout-close handler), but that's
  // best-effort — this is the server-side backstop so a stuck pending_payment transaction never
  // permanently blocks that buyer from starting a new checkout on the same listing (see the
  // existingPending guard in create()). Always re-verifies with Paystack before cancelling —
  // never assumes "unpaid" from elapsed time alone, in case the charge succeeded but the webhook
  // delivery was missed or delayed.
  @Cron(CronExpression.EVERY_HOUR)
  async sweepAbandonedCheckouts(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const stale = await this.transactionModel.find({
      status: TransactionStatus.PENDING_PAYMENT,
      createdAt: { $lte: cutoff },
    });

    let cancelled = 0;
    for (const transaction of stale) {
      let verification;
      try {
        verification = await this.paystackService.verifyTransaction(
          transaction.reference,
        );
      } catch (err) {
        this.logger.warn(
          `Could not verify stale transaction ${transaction.reference} with Paystack — leaving as-is for next sweep`,
          err as Error,
        );
        continue;
      }

      if (verification.successful) {
        // Paid on Paystack but never flipped to escrow_active — the webhook was missed. Don't
        // cancel a paid transaction; surface this loudly so it gets manual attention.
        this.logger.error(
          `Transaction ${transaction.reference} was paid on Paystack but is still pending_payment — webhook may have been missed. Needs manual review.`,
        );
        continue;
      }

      const oldStatus = transaction.status;
      transaction.status = TransactionStatus.CANCELLED;
      await transaction.save();
      await this.audit(
        transaction._id.toString(),
        'auto_cancelled_abandoned_checkout',
        'system',
        oldStatus,
        TransactionStatus.CANCELLED,
      );
      cancelled++;
    }

    if (cancelled > 0) {
      this.logger.log(`Auto-cancelled ${cancelled} abandoned checkout(s)`);
    }
  }

  private async audit(
    transactionId: string,
    event: string,
    actor: string,
    oldState: string,
    newState: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogService.record({
      entityType: 'transaction',
      entityId: transactionId,
      event,
      actor,
      oldState,
      newState,
      metadata,
    });
  }

  private async findRaw(id: string): Promise<TransactionDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Transaction not found');
    }
    const transaction = await this.transactionModel.findById(id);
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    return transaction;
  }

  private toResponseShape(
    transaction: TransactionDocument,
    requesterId: string,
  ) {
    const buyer = transaction.buyer as unknown as PopulatedParty | null;
    const seller = transaction.seller as unknown as PopulatedParty | null;
    void requesterId;

    const obj = transaction.toObject() as unknown as Record<string, unknown>;
    obj.buyer = shapeParty(buyer, 'buyer');
    obj.seller = shapeParty(seller, 'seller');
    return obj;
  }

  // One period's totals — reused for both the current and prior window.
  private async summarizeTransactions(filter: Record<string, unknown>) {
    const rows = await this.transactionModel.aggregate<{
      _id: null;
      totalTransactions: number;
      completedTransactions: number;
      totalRevenue: number;
    }>([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          completedTransactions: {
            $sum: {
              $cond: [{ $eq: ['$status', TransactionStatus.COMPLETED] }, 1, 0],
            },
          },
          totalRevenue: {
            $sum: {
              $cond: [
                { $eq: ['$status', TransactionStatus.COMPLETED] },
                '$commissionAmount',
                0,
              ],
            },
          },
        },
      },
    ]);
    const r = rows[0];
    return {
      totalTransactions: r?.totalTransactions ?? 0,
      completedTransactions: r?.completedTransactions ?? 0,
      totalRevenue: Math.round((r?.totalRevenue ?? 0) * 100) / 100,
    };
  }

  // Live, filter-independent snapshot — money the buyer has already paid that's held by the platform, not yet released to the seller or refunded. Backs the "Escrow Balance" card.
  private async getEscrowBalance(): Promise<{
    amount: number;
    count: number;
  }> {
    const rows = await this.transactionModel.aggregate<{
      _id: null;
      amount: number;
      count: number;
    }>([
      {
        $match: {
          status: {
            $in: [
              TransactionStatus.ESCROW_ACTIVE,
              TransactionStatus.AWAITING_INSPECTION,
            ],
          },
        },
      },
      {
        $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } },
      },
    ]);
    const r = rows[0];
    return {
      amount: Math.round((r?.amount ?? 0) * 100) / 100,
      count: r?.count ?? 0,
    };
  }

  // Live, filter-independent snapshot — how many transactions are currently awaiting the seller entering the buyer's code, and how many of those are close to breaching their inspection deadline. `expiringBefore` guards against `inspectionDeadlineAt` being unset on pre-rework transactions (would otherwise sort as "already expired" in the comparison).
  private async getPendingInspections(expiringBefore: Date): Promise<{
    total: number;
    expiringSoon: number;
  }> {
    const rows = await this.transactionModel.aggregate<{
      _id: null;
      total: number;
      expiringSoon: number;
    }>([
      { $match: { status: TransactionStatus.AWAITING_INSPECTION } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          expiringSoon: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$inspectionDeadlineAt', null] },
                    { $lte: ['$inspectionDeadlineAt', expiringBefore] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    const r = rows[0];
    return { total: r?.total ?? 0, expiringSoon: r?.expiringSoon ?? 0 };
  }

  // All-time — completed vs every transaction that's reached a final outcome (completed/cancelled/refunded/disputed). Excludes still-in-progress statuses (pending_payment/escrow_active/awaiting_inspection/stalled), since those haven't resolved one way or the other yet. Backs "Completed Transactions"' success-rate extra.
  private async getCompletionOutcomes(): Promise<{
    completed: number;
    total: number;
  }> {
    const rows = await this.transactionModel.aggregate<{
      _id: null;
      completed: number;
      total: number;
    }>([
      {
        $match: {
          status: {
            $in: [
              TransactionStatus.COMPLETED,
              TransactionStatus.CANCELLED,
              TransactionStatus.REFUNDED,
              TransactionStatus.DISPUTED,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $eq: ['$status', TransactionStatus.COMPLETED] }, 1, 0],
            },
          },
        },
      },
    ]);
    const r = rows[0];
    return { completed: r?.completed ?? 0, total: r?.total ?? 0 };
  }

  // Live count of disputed transactions, split by whether they've sat untouched past the SLA cutoff — reuses inspectionWindow.inspectionPeriod as the SLA proxy (no dedicated "dispute SLA" setting exists yet, judgment call, flagged) via updatedAt (same proxy-timestamp caveat as getRevenueTrends). Used to also cover STALLED (removed 2026-09-13 — see TransactionStatus) — that count was already unused by getDashboardInsights() below even before the status itself was removed.
  private async summarizeAttentionStates(slaCutoff: Date) {
    const rows = await this.transactionModel.aggregate<{
      total: number;
      breaching: number;
    }>([
      { $match: { status: TransactionStatus.DISPUTED } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          breaching: {
            $sum: { $cond: [{ $lte: ['$updatedAt', slaCutoff] }, 1, 0] },
          },
        },
      },
    ]);
    return { disputed: rows[0] ?? { total: 0, breaching: 0 } };
  }

  // Backs 6 of the admin Dashboard's 8 "insights" cards — each returned as {value, extra}. See AdminService.getDashboardInsights() for the other 2 cards (numberOfUsers/newListings) and the filter/prior-period math. Reworked 2026-08-26 for the new 8-card set (Revenue/Escrow Balance/Transaction Today/Pending Inspections/Open Disputes/Completed Transactions here; avgOrderValue and stalledTransactions dropped — no longer part of the card set). escrowBalance/pendingInspections/openDisputes stay live, filter-independent snapshots ("what needs my attention right now") — same reasoning already established for the old disputed/stalled cards; revenue/transactionsToday/completedTransactions.value scope to the selected filter period.
  async getDashboardInsights(
    since: Date,
    until: Date,
    priorSince: Date,
    priorUntil: Date,
  ): Promise<{
    transactionsToday: { value: number; extra: Trend };
    completedTransactions: { value: number; extra: Trend };
    revenue: { value: number; extra: Trend };
    escrowBalance: { value: number; extra: Trend };
    pendingInspections: { value: number; extra: Trend };
    openDisputes: { value: number; extra: Trend };
  }> {
    const periodFilter = { createdAt: { $gte: since, $lt: until } };
    const priorFilter = { createdAt: { $gte: priorSince, $lt: priorUntil } };
    const { inspectionWindow } = await this.settingsService.get();
    const slaCutoff = new Date(
      Date.now() - inspectionWindow.inspectionPeriod * 24 * 60 * 60 * 1000,
    );
    const sixHoursFromNow = new Date(Date.now() + 6 * 60 * 60 * 1000);

    const [current, prior, attention, escrow, inspections, outcomes] =
      await Promise.all([
        this.summarizeTransactions(periodFilter),
        this.summarizeTransactions(priorFilter),
        this.summarizeAttentionStates(slaCutoff),
        this.getEscrowBalance(),
        this.getPendingInspections(sixHoursFromNow),
        this.getCompletionOutcomes(),
      ]);

    // No admin-configurable "healthy success rate" threshold exists yet — 90% picked as a reasonable bar, judgment call, flagged.
    const successRate =
      outcomes.total > 0
        ? Math.round((outcomes.completed / outcomes.total) * 1000) / 10
        : 0;

    return {
      transactionsToday: {
        value: current.totalTransactions,
        extra: pctTrend(
          current.totalTransactions,
          prior.totalTransactions,
          true,
          (pct, dir) => `${pct}% ${dir}`,
          (value) => `${value} this period`,
        ),
      },
      completedTransactions: {
        value: current.completedTransactions,
        extra: {
          status: successRate >= 90 ? 'productive' : 'warning',
          result: `${successRate}% success rate`,
        },
      },
      revenue: {
        value: current.totalRevenue,
        extra: pctTrend(
          current.totalRevenue,
          prior.totalRevenue,
          true,
          (pct) => `${pct}% vs prior period`,
          (value) => `${formatNairaShort(value)} this period`,
        ),
      },
      // Always 'warning' (informational, not a performance trend) — matches the screenshot's orange indicator, distinct from the green up-arrow trend cards.
      escrowBalance: {
        value: escrow.amount,
        extra: {
          status: 'warning',
          result: `held across ${escrow.count} transaction${escrow.count === 1 ? '' : 's'}`,
        },
      },
      pendingInspections: {
        value: inspections.total,
        extra: breachTrend(inspections.expiringSoon, 'expiring in <6H'),
      },
      openDisputes: {
        value: attention.disputed.total,
        extra: breachTrend(attention.disputed.breaching, 'breaching SLA'),
      },
    };
  }

  // Backs the admin Dashboard revenue-trends chart — always Jan-Dec of the given calendar year, zero-filled, bucketed by `updatedAt` as a proxy for "when it completed" (no dedicated completedAt field, but COMPLETED is set immediately before the save that stamps it). trend[] carries both grossRevenue and commissionAmount per month (2026-08-26: previously only commission, exposed as `revenue`); insights.twelveMonthGross/bestMonth/avgPerMonth/totalRemittance are now derived straight from trend[] instead of a separate re-aggregation, same numbers as before, one fewer pass over the data.
  async getRevenueTrends(year: number): Promise<{
    trend: Array<{
      year: number;
      month: string;
      grossRevenue: number;
      commissionAmount: number;
    }>;
    insights: {
      twelveMonthGross: string;
      bestMonth: string;
      avgPerMonth: string;
      totalRemittance: string;
    };
  }> {
    const startOfYear = new Date(year, 0, 1);
    const startOfNextYear = new Date(year + 1, 0, 1);

    const rows = await this.transactionModel.aggregate<{
      _id: number;
      grossAmount: number;
      commissionAmount: number;
    }>([
      {
        $match: {
          status: TransactionStatus.COMPLETED,
          updatedAt: { $gte: startOfYear, $lt: startOfNextYear },
        },
      },
      {
        $group: {
          _id: { $month: '$updatedAt' },
          grossAmount: { $sum: '$amount' },
          commissionAmount: { $sum: '$commissionAmount' },
        },
      },
    ]);
    const byMonth = new Map(rows.map((r) => [r._id, r]));

    const trend = MONTH_ABBREVIATIONS.map((month, i) => {
      const bucket = byMonth.get(i + 1);
      return {
        year,
        month,
        grossRevenue: Math.round((bucket?.grossAmount ?? 0) * 100) / 100,
        commissionAmount:
          Math.round((bucket?.commissionAmount ?? 0) * 100) / 100,
      };
    });

    const twelveMonthGross = trend.reduce((sum, m) => sum + m.grossRevenue, 0);
    const bestMonthIndex = trend.reduce(
      (maxIdx, m, i) =>
        m.grossRevenue > trend[maxIdx].grossRevenue ? i : maxIdx,
      0,
    );
    const totalRemittance = trend.reduce(
      (sum, m) => sum + (m.grossRevenue - m.commissionAmount),
      0,
    );

    return {
      trend,
      insights: {
        twelveMonthGross: formatNairaShort(twelveMonthGross),
        bestMonth: `${MONTH_NAMES[bestMonthIndex]} - ${formatNairaShort(trend[bestMonthIndex].grossRevenue)}`,
        avgPerMonth: formatNairaShort(twelveMonthGross / 12),
        totalRemittance: formatNairaFull(totalRemittance),
      },
    };
  }

  // Backs the admin Dashboard "category distribution" panel — top 5 categories by number of COMPLETED transactions, each with its share of all completed transactions and total gross amount. Judgment calls, flagged: scoped to completed transactions only (business-volume framing, not every checkout attempt), "amount" is gross transaction value (not commission) — neither pinned down beyond the mock's count/%/₦ columns.
  async getCategoryDistribution(): Promise<
    Array<{
      category: string;
      slug: string;
      transactionCount: number;
      percentage: number;
      amount: number;
    }>
  > {
    const [rows, totalCompleted] = await Promise.all([
      this.transactionModel.aggregate<{
        _id: Types.ObjectId;
        transactionCount: number;
        amount: number;
        category: { title: string; slug: string }[];
      }>([
        { $match: { status: TransactionStatus.COMPLETED } },
        {
          $lookup: {
            from: 'listings',
            localField: 'listing',
            foreignField: '_id',
            as: 'listingDoc',
          },
        },
        { $unwind: '$listingDoc' },
        {
          $group: {
            _id: '$listingDoc.category',
            transactionCount: { $sum: 1 },
            amount: { $sum: '$amount' },
          },
        },
        { $sort: { transactionCount: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'categories',
            localField: '_id',
            foreignField: '_id',
            as: 'category',
            pipeline: [{ $project: { title: 1, slug: 1 } }],
          },
        },
      ]),
      this.transactionModel.countDocuments({
        status: TransactionStatus.COMPLETED,
      }),
    ]);

    return rows.map((r) => {
      const cat = r.category[0];
      return {
        category: cat?.title ?? 'Uncategorized',
        slug: cat?.slug ?? '',
        transactionCount: r.transactionCount,
        percentage:
          totalCompleted > 0
            ? Math.round((r.transactionCount / totalCompleted) * 1000) / 10
            : 0,
        amount: Math.round(r.amount * 100) / 100,
      };
    });
  }

  // Backs the dashboard's transaction-status donut — `total` is the sum of just these 4 buckets, not every Transaction document (pending_payment/escrow_active are still in-progress, stalled/refunded are already surfaced elsewhere), matching the 4-slice donut having no "other" wedge.
  async getStatusBreakdown(): Promise<{
    total: number;
    completed: { count: number; percentage: number };
    awaitingInspection: { count: number; percentage: number };
    disputed: { count: number; percentage: number };
    cancelled: { count: number; percentage: number };
  }> {
    const statuses = [
      TransactionStatus.COMPLETED,
      TransactionStatus.AWAITING_INSPECTION,
      TransactionStatus.DISPUTED,
      TransactionStatus.CANCELLED,
    ];
    const rows = await this.transactionModel.aggregate<{
      _id: TransactionStatus;
      count: number;
    }>([
      { $match: { status: { $in: statuses } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const counts = new Map(rows.map((r) => [r._id, r.count]));
    const total = statuses.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0);

    const bucket = (status: TransactionStatus) => {
      const count = counts.get(status) ?? 0;
      return {
        count,
        percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      };
    };

    return {
      total,
      completed: bucket(TransactionStatus.COMPLETED),
      awaitingInspection: bucket(TransactionStatus.AWAITING_INSPECTION),
      disputed: bucket(TransactionStatus.DISPUTED),
      cancelled: bucket(TransactionStatus.CANCELLED),
    };
  }

  // Requires buyer/seller/listing already populated — same contract as toResponseShape() above.
  private toAdminResponseShape(transaction: TransactionDocument) {
    const obj = transaction.toObject() as unknown as Record<string, unknown>;
    obj.buyer = shapeParty(
      transaction.buyer as unknown as PopulatedParty | null,
      'buyer',
    );
    obj.seller = shapeParty(
      transaction.seller as unknown as PopulatedParty | null,
      'seller',
    );
    // Belt-and-suspenders fallback for a currently-disputed transaction
    // whose disputeStatus somehow wasn't set (e.g. legacy data predating
    // this field) — a transaction that's never been disputed simply keeps
    // the raw (undefined) value, omitted from the JSON response.
    obj.disputeStatus =
      transaction.status === TransactionStatus.DISPUTED
        ? (transaction.disputeStatus ?? DisputeStatus.UNDER_INVESTIGATION)
        : transaction.disputeStatus;
    return obj;
  }
}
