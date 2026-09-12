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
  InspectionStatus,
  Transaction,
  TransactionDocument,
  TransactionStatus,
} from './schemas/transaction.schema';
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
import { NotificationRecipientType } from '../notifications/schemas/notification.schema';
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

interface PaystackWebhookPayload {
  event: string;
  data?: { reference?: string };
}

const PARTY_POPULATE_FIELDS = 'name email accountStatus slug company';
const LISTING_POPULATE_FIELDS = 'title mainImageUrl';
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

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    private readonly escrowService: EscrowService,
    private readonly listingsService: ListingsService,
    private readonly usersService: UsersService,
    private readonly paystackService: PaystackService,
    private readonly trustScoreService: TrustScoreService,
    private readonly notificationsService: NotificationsService,
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
      this.logger.log(`[webhook] ignoring non-charge.success event: ${payload.event}`);
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
      this.logger.warn(`[webhook] no local transaction found for reference=${reference}`);
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
      transaction.inspectionStatus = InspectionStatus.DISPUTED;
      transaction.paystackFee = paystackFeeKobo / 100;
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
    transaction.paystackFee = paystackFeeKobo / 100;
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
    await this.paystackService.releaseToSeller({
      bankCode: bankAccount.bankCode,
      accountNumber: bankAccount.accountNumber,
      accountName: bankAccount.accountHolderName,
      amountKobo: Math.round(sellerPayoutAmount * 100),
      reference: `declut_payout_${transaction._id.toString()}`,
    });

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.COMPLETED;
    transaction.commissionAmount = commissionAmount;
    transaction.sellerPayoutAmount = sellerPayoutAmount;
    transaction.inspectionStatus = InspectionStatus.COMPLETED;
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.RELEASED,
    );
    await this.listingsService.markSold(transaction.listing.toString());

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
    await this.paystackService.refund(
      transaction.reference,
      Math.round(refundAmount * 100),
    );

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.REFUNDED;
    transaction.commissionAmount = commissionAmount;
    transaction.inspectionStatus = InspectionStatus.REFUNDED;
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

  async findForUserDisplay(transactionId: string, userId: string) {
    const transaction = await this.findForUser(transactionId, userId);
    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toResponseShape(transaction, userId);
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
      this.logger.warn(`[deep-link] no transaction found for reference=${reference}`);
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

  // `statuses` (plural) so AdminService's tab-vs-status filtering can pass either a single status or a grouped set (e.g. the "active" tab) through the same query path.
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

  // Currently unused (superseded by adminFindByIdDetailed() below) — kept populated too so it isn't a landmine if something starts calling it.
  async adminFindById(transactionId: string) {
    const transaction = await this.findRaw(transactionId);
    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toAdminResponseShape(transaction);
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
  async adminRelease(transactionId: string, adminId: string) {
    const transaction = await this.findRaw(transactionId);
    if (
      ![TransactionStatus.STALLED, TransactionStatus.DISPUTED].includes(
        transaction.status,
      )
    ) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — admin release only applies to stalled or disputed transactions`,
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
    await this.paystackService.releaseToSeller({
      bankCode: bankAccount.bankCode,
      accountNumber: bankAccount.accountNumber,
      accountName: bankAccount.accountHolderName,
      amountKobo: Math.round(sellerPayoutAmount * 100),
      reference: `declut_admin_release_${transaction._id.toString()}`,
    });

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.COMPLETED;
    transaction.commissionAmount = commissionAmount;
    transaction.sellerPayoutAmount = sellerPayoutAmount;
    transaction.inspectionStatus = InspectionStatus.COMPLETED;
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.RELEASED,
    );
    await this.listingsService.markSold(transaction.listing.toString());

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

  async adminRefund(transactionId: string, adminId: string, reason?: string) {
    const transaction = await this.findRaw(transactionId);
    if (
      ![TransactionStatus.STALLED, TransactionStatus.DISPUTED].includes(
        transaction.status,
      )
    ) {
      throw new BadRequestException(
        `Transaction is ${transaction.status} — admin refund only applies to stalled or disputed transactions`,
      );
    }

    // Paystack call before the local write — same ordering rule as everywhere else money moves in this module.
    await this.paystackService.refund(transaction.reference);

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.REFUNDED;
    transaction.inspectionStatus = InspectionStatus.REFUNDED;
    await transaction.save();
    await this.escrowService.updateStatusForTransaction(
      transaction._id.toString(),
      EscrowStatus.REFUNDED,
    );
    await this.listingsService.revertToActive(transaction.listing.toString());

    await this.audit(
      transactionId,
      'admin_refunded',
      adminId,
      oldStatus,
      TransactionStatus.REFUNDED,
      { reason },
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
      title: 'Transaction refunded',
      body: 'An admin reviewed a transaction on your listing and refunded the buyer.',
      data: { transactionId },
    });

    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toAdminResponseShape(transaction);
  }

  // Runs hourly rather than daily — checking more often just means a stalled transaction gets flagged closer to the actual threshold instead of up to a day late.
  @Cron(CronExpression.EVERY_HOUR)
  async sweepStalledTransactions(): Promise<void> {
    const { inspectionWindow } = await this.settingsService.get();

    const stale = await this.transactionModel.find({
      status: {
        $in: [
          TransactionStatus.ESCROW_ACTIVE,
          TransactionStatus.AWAITING_INSPECTION,
        ],
      },
      inspectionDeadlineAt: { $lte: new Date() },
    });

    for (const transaction of stale) {
      const oldStatus = transaction.status;
      transaction.status = TransactionStatus.STALLED;
      await transaction.save();
      await this.audit(
        transaction._id.toString(),
        'auto_flagged_stalled',
        'system',
        oldStatus,
        TransactionStatus.STALLED,
        { thresholdDays: inspectionWindow.inspectionPeriod },
      );

      await Promise.all([
        this.notificationsService.notify({
          recipientType: NotificationRecipientType.USER,
          recipientId: transaction.buyer.toString(),
          type: 'transaction_stalled',
          title: 'Transaction stalled',
          body: 'This transaction has been inactive too long and was flagged for review.',
          data: { transactionId: transaction._id.toString() },
        }),
        this.notificationsService.notify({
          recipientType: NotificationRecipientType.USER,
          recipientId: transaction.seller.toString(),
          type: 'transaction_stalled',
          title: 'Transaction stalled',
          body: 'This transaction has been inactive too long and was flagged for review.',
          data: { transactionId: transaction._id.toString() },
        }),
      ]);
    }

    if (stale.length > 0) {
      this.logger.log(`Flagged ${stale.length} transaction(s) as stalled`);
    }
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

  // Live count of disputed/stalled transactions, split by whether they've sat untouched past the SLA cutoff — reuses inspectionWindow.inspectionPeriod as the SLA proxy (no dedicated "dispute SLA" setting exists yet, judgment call, flagged) via updatedAt (same proxy-timestamp caveat as getRevenueTrends).
  private async summarizeAttentionStates(slaCutoff: Date) {
    const rows = await this.transactionModel.aggregate<{
      _id: TransactionStatus;
      total: number;
      breaching: number;
    }>([
      {
        $match: {
          status: {
            $in: [TransactionStatus.DISPUTED, TransactionStatus.STALLED],
          },
        },
      },
      {
        $group: {
          _id: '$status',
          total: { $sum: 1 },
          breaching: {
            $sum: { $cond: [{ $lte: ['$updatedAt', slaCutoff] }, 1, 0] },
          },
        },
      },
    ]);
    const find = (status: TransactionStatus) =>
      rows.find((r) => r._id === status) ?? { total: 0, breaching: 0 };
    return {
      disputed: find(TransactionStatus.DISPUTED),
      stalled: find(TransactionStatus.STALLED),
    };
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
    return obj;
  }
}
