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
import { randomInt, randomUUID } from 'crypto';
import {
  Transaction,
  TransactionDocument,
  TransactionStatus,
} from './schemas/transaction.schema';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ConfirmCodeDto } from './dto/confirm-code.dto';
import { ListingsService } from '../listings/listings.service';
import { OffersService } from '../offers/offers.service';
import { OfferStatus } from '../offers/schemas/offer.schema';
import { UsersService } from '../users/users.service';
import { PaystackService } from '../payments/paystack.service';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CounterService } from '../common/counter/counter.service';
import {
  formatNairaFull,
  formatNairaShort,
} from '../common/utils/currency.util';
import { pctTrend, breachTrend, Trend } from '../common/utils/trend.util';
import { MONTH_ABBREVIATIONS } from '../common/utils/date.util';

interface PaystackWebhookPayload {
  event: string;
  data?: { reference?: string };
}

const PARTY_POPULATE_FIELDS = 'name email accountStatus slug company';
const LISTING_POPULATE_FIELDS = 'title';
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

interface PopulatedParty {
  _id: Types.ObjectId;
  name: string;
  email: string;
  accountStatus: string;
  slug?: string;
  company?: string;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    private readonly listingsService: ListingsService,
    private readonly offersService: OffersService,
    private readonly usersService: UsersService,
    private readonly paystackService: PaystackService,
    private readonly trustScoreService: TrustScoreService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly auditLogService: AuditLogService,
    private readonly counterService: CounterService,
  ) {}

  async create(buyerId: string, dto: CreateTransactionDto) {
    const listing = await this.listingsService.findById(dto.listingId);
    if (listing.seller.toString() === buyerId) {
      throw new BadRequestException('You cannot buy your own listing');
    }

    const existingPending = await this.transactionModel.findOne({
      listing: dto.listingId,
      buyer: buyerId,
      status: TransactionStatus.PENDING_PAYMENT,
    });
    if (existingPending) {
      throw new ConflictException(
        'You already have a checkout in progress for this listing',
      );
    }

    let amount = listing.price;
    let offerId: string | undefined;

    if (dto.offerId) {
      const offer = await this.offersService.findById(dto.offerId, buyerId);
      if (offer.buyer.toString() !== buyerId) {
        throw new ForbiddenException('This offer does not belong to you');
      }
      if (offer.listing.toString() !== dto.listingId) {
        throw new BadRequestException('Offer does not match this listing');
      }
      if (offer.status !== OfferStatus.ACCEPTED) {
        throw new BadRequestException('Offer must be accepted before checkout');
      }
      amount = offer.amount;
      offerId = offer._id.toString();
    }

    const seller = await this.usersService.findById(listing.seller.toString());
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }
    if (!seller.bankCode || !seller.accountNumber || !seller.accountName) {
      throw new BadRequestException(
        "This seller hasn't set up payout details yet — they need to add bank details before this listing can be purchased",
      );
    }

    let subaccountCode = seller.paystackSubaccountCode;
    if (!subaccountCode) {
      subaccountCode = await this.paystackService.createSubaccount({
        businessName: seller.name,
        bankCode: seller.bankCode,
        accountNumber: seller.accountNumber,
      });
      await this.usersService.setPaystackSubaccountCode(
        seller._id.toString(),
        subaccountCode,
      );
    }

    const buyer = await this.usersService.findById(buyerId);
    if (!buyer) {
      throw new NotFoundException('Buyer not found');
    }

    const reference = `declut_${randomUUID()}`;
    const { commissionPercentage } = await this.settingsService.get();

    // Paystack call happens BEFORE the local record is persisted — if this
    // throws (Paystack down, bad request, whatever), there's nothing to
    // clean up. Creating the Transaction row first and populating it after
    // would leave an orphaned pending_payment record with no checkout URL
    // ever handed to the buyer if this call failed. The human-readable
    // reference's counter increment is deferred until after this call for
    // the same reason — no point burning a sequence number on an attempt
    // that never becomes a real transaction.
    const init = await this.paystackService.initializeTransaction({
      email: buyer.email,
      amountKobo: Math.round(amount * 100),
      reference,
      subaccountCode,
    });

    const year = new Date().getFullYear();
    const humanReference = `TXN-${year}-${String(
      await this.counterService.next(`transaction-${year}`),
    ).padStart(5, '0')}`;

    const transaction = await this.transactionModel.create({
      listing: dto.listingId,
      buyer: buyerId,
      seller: listing.seller,
      offer: offerId,
      amount,
      commissionPercentage,
      status: TransactionStatus.PENDING_PAYMENT,
      paystackReference: reference,
      reference: humanReference,
    });

    await this.audit(
      transaction._id.toString(),
      'checkout_initiated',
      buyerId,
      'none',
      TransactionStatus.PENDING_PAYMENT,
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
    if (!this.paystackService.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = JSON.parse(
      rawBody.toString('utf8'),
    ) as PaystackWebhookPayload;
    if (payload.event !== 'charge.success') {
      return;
    }

    const reference = payload.data?.reference;
    if (!reference) {
      this.logger.warn('Webhook payload missing data.reference — ignoring');
      return;
    }

    const transaction = await this.transactionModel.findOne({
      paystackReference: reference,
    });
    if (!transaction) {
      this.logger.warn(`Webhook for unknown reference: ${reference}`);
      return;
    }

    // Idempotency: a retried webhook for a transaction that's already past
    // pending_payment is a no-op, not a re-activation.
    if (transaction.status !== TransactionStatus.PENDING_PAYMENT) {
      return;
    }

    // Don't trust the webhook payload alone — re-verify server-to-server.
    const verification =
      await this.paystackService.verifyTransaction(reference);
    if (!verification.successful) {
      return;
    }

    const expectedKobo = Math.round(transaction.amount * 100);
    if (verification.amountKobo !== expectedKobo) {
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

    const { escrowStalledThresholdDays } = await this.settingsService.get();
    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.ESCROW_ACTIVE;
    transaction.escrowActiveAt = new Date();
    transaction.inspectionDeadlineAt = new Date(
      transaction.escrowActiveAt.getTime() +
        escrowStalledThresholdDays * 24 * 60 * 60 * 1000,
    );
    transaction.confirmationCode = this.generateConfirmationCode();
    await transaction.save();

    await this.audit(
      transaction._id.toString(),
      'escrow_held',
      'webhook',
      oldStatus,
      TransactionStatus.ESCROW_ACTIVE,
    );

    await this.notificationsService.notifyUser(transaction.seller.toString(), {
      title: 'Payment received',
      body: `₦${transaction.amount.toLocaleString()} is now held in escrow — meet the buyer to complete the sale.`,
      data: {
        type: 'payment_received',
        transactionId: transaction._id.toString(),
      },
    });
    await this.notificationsService.notifyUser(transaction.buyer.toString(), {
      title: 'Payment confirmed',
      body: 'Your confirmation code is ready — share it with the seller at the meetup.',
      data: {
        type: 'payment_received',
        transactionId: transaction._id.toString(),
      },
    });
  }

  async confirmCode(
    transactionId: string,
    sellerId: string,
    dto: ConfirmCodeDto,
  ) {
    const transaction = await this.findRaw(transactionId);
    if (transaction.seller.toString() !== sellerId) {
      throw new ForbiddenException(
        'Only the seller can confirm the code for this transaction',
      );
    }
    if (
      ![
        TransactionStatus.ESCROW_ACTIVE,
        TransactionStatus.AWAITING_INSPECTION,
      ].includes(transaction.status)
    ) {
      throw new BadRequestException(
        `Transaction is ${transaction.status}, code confirmation not available`,
      );
    }

    if (transaction.confirmationCode !== dto.code) {
      return this.handleWrongCode(transaction, sellerId);
    }

    const seller = await this.usersService.findById(sellerId);
    if (!seller?.bankCode || !seller.accountNumber || !seller.accountName) {
      // Shouldn't happen — create() already required these — but a
      // money-movement step should never assume, always re-check.
      throw new InternalServerErrorException(
        'Seller payout details are missing',
      );
    }

    const rawCommission =
      (transaction.amount * transaction.commissionPercentage) / 100;
    const commissionAmount = Math.round(rawCommission * 100) / 100;
    const sellerPayoutAmount =
      Math.round((transaction.amount - commissionAmount) * 100) / 100;

    await this.paystackService.releaseToSeller({
      bankCode: seller.bankCode,
      accountNumber: seller.accountNumber,
      accountName: seller.accountName,
      amountKobo: Math.round(sellerPayoutAmount * 100),
      reference: `declut_payout_${transaction._id.toString()}`,
    });

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.COMPLETED;
    transaction.commissionAmount = commissionAmount;
    transaction.sellerPayoutAmount = sellerPayoutAmount;
    transaction.confirmationCode = undefined;
    await transaction.save();
    await this.listingsService.markSold(transaction.listing.toString());

    await this.audit(
      transactionId,
      'funds_released',
      sellerId,
      oldStatus,
      TransactionStatus.COMPLETED,
      { commissionAmount, sellerPayoutAmount },
    );

    // Completed-transaction count feeds both parties' trust score —
    // recalculated here rather than live on every profile read.
    await Promise.all([
      this.trustScoreService.recalculate(transaction.buyer.toString()),
      this.trustScoreService.recalculate(transaction.seller.toString()),
    ]);

    await this.notificationsService.notifyUser(transaction.seller.toString(), {
      title: 'Funds released',
      body: `₦${sellerPayoutAmount.toLocaleString()} has been sent to your account.`,
      data: { type: 'funds_released', transactionId },
    });
    await this.notificationsService.notifyUser(transaction.buyer.toString(), {
      title: 'Sale completed',
      body: 'The seller confirmed your code and the sale is complete. Leave a review!',
      data: { type: 'funds_released', transactionId },
    });

    return { status: 'completed' };
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
        'Only a transaction awaiting payment can be cancelled directly — a paid transaction requires admin resolution',
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

  // Raw — buyer/seller/listing stay unpopulated ObjectIds. Used internally
  // by ReviewsService.create(), which reads transaction.buyer/.seller/
  // .listing directly; populating here would corrupt those comparisons and
  // the new Review's `listing` ref. See findForUserDisplay() for the
  // populated variant the transactions controller actually returns to a
  // client.
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

  async findForUserDisplay(transactionId: string, userId: string) {
    const transaction = await this.findForUser(transactionId, userId);
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

  // Admin-only surface — always strips confirmationCode regardless of who's
  // asking, same "only ever returned to the buyer" invariant as
  // toResponseShape(), since an admin resolving a dispute needs the
  // transaction's state, not the buyer's private code.
  // `statuses` (plural) rather than a single status so AdminService's
  // tab-vs-status filtering (see admin.service.ts) can pass either an exact
  // single-status match or a grouped set of statuses (e.g. the "active" tab
  // spanning pending_payment/escrow_active/awaiting_inspection) through the
  // same query path.
  async adminList(page: number, limit: number, statuses?: TransactionStatus[]) {
    const filter =
      statuses && statuses.length ? { status: { $in: statuses } } : {};
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
      results: results.map((t) => this.toAdminResponseShape(t)),
      total,
      page,
      limit,
    };
  }

  // Currently unused (superseded by adminFindByIdDetailed() below) — kept
  // populated too so it isn't a landmine if something starts calling it.
  async adminFindById(transactionId: string) {
    const transaction = await this.findRaw(transactionId);
    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toAdminResponseShape(transaction);
  }

  // Rich admin detail view: populated buyer/seller/listing, a computed
  // progress-stage timeline, the virtual escrow view (still just a read
  // over Transaction fields — no separate Escrow collection), and the
  // generalized AuditLog as the event timeline.
  async adminFindByIdDetailed(transactionId: string) {
    const transaction = await this.findRaw(transactionId);
    const [buyer, seller, listing, settings, timeline] = await Promise.all([
      this.usersService.findById(transaction.buyer.toString()),
      this.usersService.findById(transaction.seller.toString()),
      this.listingsService.adminFindByIdWithCategory(
        transaction.listing.toString(),
      ),
      this.settingsService.get(),
      this.auditLogService.findForEntity('transaction', transactionId, 20),
    ]);

    const status = transaction.status;
    const isTerminalBranch = [
      TransactionStatus.STALLED,
      TransactionStatus.DISPUTED,
      TransactionStatus.REFUNDED,
      TransactionStatus.CANCELLED,
    ].includes(status);

    const stages = [
      {
        key: 'payment_initiated',
        completed: true,
        at: (transaction as unknown as { createdAt: Date }).createdAt,
      },
      {
        key: 'escrow_active',
        completed: Boolean(transaction.escrowActiveAt),
        at: transaction.escrowActiveAt,
      },
      {
        key: 'completed',
        completed: status === TransactionStatus.COMPLETED,
        at:
          status === TransactionStatus.COMPLETED
            ? (transaction as unknown as { updatedAt: Date }).updatedAt
            : undefined,
      },
    ];
    if (isTerminalBranch) {
      stages.push({
        key: status,
        completed: true,
        at: (transaction as unknown as { updatedAt: Date }).updatedAt,
      });
    }

    const commissionAmount =
      transaction.commissionAmount ??
      Math.round(
        ((transaction.amount * transaction.commissionPercentage) / 100) * 100,
      ) / 100;

    return {
      reference: transaction.reference,
      status,
      amount: transaction.amount,
      buyer: buyer ? this.shapeParty(buyer, 'buyer') : null,
      seller: seller ? this.shapeParty(seller, 'seller') : null,
      // "defect summary text" from the spec has no home yet — Listing has
      // no defect/condition-notes field beyond `description`, and nothing
      // else in this codebase tracks it. Left out rather than guessed;
      // flag back if that should map to `description` or be a new field.
      listing: {
        id: listing._id.toString(),
        title: listing.title,
        slug: listing.slug,
        description: listing.description,
        brand: listing.specs?.brand,
        condition: listing.condition,
        price: listing.price,
        location: listing.locationLabel,
        status: listing.status,
        createdAt: (listing as unknown as { createdAt: Date }).createdAt,
        category:
          listing.category && typeof listing.category === 'object'
            ? {
                name: (listing.category as unknown as { title: string }).title,
                slug: (listing.category as unknown as { slug: string }).slug,
              }
            : null,
      },
      stages,
      payment: {
        paystackReference: transaction.paystackReference,
        platformFeePercentage: transaction.commissionPercentage,
        platformFeeAmount: commissionAmount,
        sellerPayoutAmount:
          transaction.sellerPayoutAmount ??
          Math.round((transaction.amount - commissionAmount) * 100) / 100,
        // Honesty flag, same spirit as the QoreID/Paystack notes elsewhere:
        // Paystack's own processing fee isn't captured anywhere in this
        // codebase (only the platform commission is), so this is reported
        // as unknown rather than guessed.
        processingFee: null,
      },
      escrow: {
        active: [
          TransactionStatus.ESCROW_ACTIVE,
          TransactionStatus.AWAITING_INSPECTION,
        ].includes(status),
        heldSince: transaction.escrowActiveAt,
        stalledThresholdDays: settings.escrowStalledThresholdDays,
        inspectionDeadlineAt: transaction.inspectionDeadlineAt,
      },
      timeline,
    };
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

  // Money moves automatically only on the unambiguous "correct code
  // entered" case (confirmCode()) — everything else requires this explicit
  // admin action, per CLAUDE.md's transaction state machine step 8.
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
    if (!seller?.bankCode || !seller.accountNumber || !seller.accountName) {
      throw new InternalServerErrorException(
        'Seller payout details are missing',
      );
    }

    const rawCommission =
      (transaction.amount * transaction.commissionPercentage) / 100;
    const commissionAmount = Math.round(rawCommission * 100) / 100;
    const sellerPayoutAmount =
      Math.round((transaction.amount - commissionAmount) * 100) / 100;

    // Paystack call before the local write — same money-movement ordering
    // rule as confirmCode()'s release path.
    await this.paystackService.releaseToSeller({
      bankCode: seller.bankCode,
      accountNumber: seller.accountNumber,
      accountName: seller.accountName,
      amountKobo: Math.round(sellerPayoutAmount * 100),
      reference: `declut_admin_release_${transaction._id.toString()}`,
    });

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.COMPLETED;
    transaction.commissionAmount = commissionAmount;
    transaction.sellerPayoutAmount = sellerPayoutAmount;
    transaction.confirmationCode = undefined;
    await transaction.save();
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

    await this.notificationsService.notifyUser(transaction.seller.toString(), {
      title: 'Funds released',
      body: `An admin resolved your transaction — ₦${sellerPayoutAmount.toLocaleString()} has been sent to your account.`,
      data: { type: 'admin_released', transactionId },
    });
    await this.notificationsService.notifyUser(transaction.buyer.toString(), {
      title: 'Transaction resolved',
      body: 'An admin reviewed your transaction and released funds to the seller.',
      data: { type: 'admin_released', transactionId },
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

    // Paystack call before the local write — same ordering rule as
    // everywhere else money moves in this module.
    await this.paystackService.refund(transaction.paystackReference);

    const oldStatus = transaction.status;
    transaction.status = TransactionStatus.REFUNDED;
    transaction.confirmationCode = undefined;
    await transaction.save();

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

    await this.notificationsService.notifyUser(transaction.buyer.toString(), {
      title: 'Transaction refunded',
      body: 'An admin reviewed your transaction and issued a refund.',
      data: { type: 'admin_refunded', transactionId },
    });
    await this.notificationsService.notifyUser(transaction.seller.toString(), {
      title: 'Transaction refunded',
      body: 'An admin reviewed a transaction on your listing and refunded the buyer.',
      data: { type: 'admin_refunded', transactionId },
    });

    await transaction.populate([
      { path: 'buyer', select: PARTY_POPULATE_FIELDS },
      { path: 'seller', select: PARTY_POPULATE_FIELDS },
      { path: 'listing', select: LISTING_POPULATE_FIELDS },
    ]);
    return this.toAdminResponseShape(transaction);
  }

  // Runs hourly rather than daily — escrowStalledThresholdDays is a count
  // of days, but checking more often just means a stalled transaction gets
  // flagged closer to the actual threshold instead of up to a day late.
  @Cron(CronExpression.EVERY_HOUR)
  async sweepStalledTransactions(): Promise<void> {
    const { escrowStalledThresholdDays: thresholdDays } =
      await this.settingsService.get();
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

    const stale = await this.transactionModel.find({
      status: {
        $in: [
          TransactionStatus.ESCROW_ACTIVE,
          TransactionStatus.AWAITING_INSPECTION,
        ],
      },
      escrowActiveAt: { $lte: cutoff },
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
        { thresholdDays },
      );

      await Promise.all([
        this.notificationsService.notifyUser(transaction.buyer.toString(), {
          title: 'Transaction stalled',
          body: 'This transaction has been inactive too long and was flagged for review.',
          data: {
            type: 'transaction_stalled',
            transactionId: transaction._id.toString(),
          },
        }),
        this.notificationsService.notifyUser(transaction.seller.toString(), {
          title: 'Transaction stalled',
          body: 'This transaction has been inactive too long and was flagged for review.',
          data: {
            type: 'transaction_stalled',
            transactionId: transaction._id.toString(),
          },
        }),
      ]);

      this.notificationsService.notifyAdmins('transaction.stalled', {
        transactionId: transaction._id.toString(),
        buyer: transaction.buyer.toString(),
        seller: transaction.seller.toString(),
        amount: transaction.amount,
        thresholdDays,
      });
    }

    if (stale.length > 0) {
      this.logger.log(`Flagged ${stale.length} transaction(s) as stalled`);
    }
  }

  private async handleWrongCode(
    transaction: TransactionDocument,
    sellerId: string,
  ) {
    transaction.failedCodeAttempts += 1;
    const { maxCodeAttempts: maxAttempts } = await this.settingsService.get();
    const oldStatus = transaction.status;

    if (transaction.failedCodeAttempts >= maxAttempts) {
      transaction.status = TransactionStatus.DISPUTED;
      await transaction.save();
      await this.audit(
        transaction._id.toString(),
        'code_mismatch_max_attempts',
        sellerId,
        oldStatus,
        TransactionStatus.DISPUTED,
        { attempts: transaction.failedCodeAttempts },
      );

      // Dispute rate feeds both parties' trust score — recalculated again
      // when an admin later resolves this via adminRelease()/adminRefund().
      await Promise.all([
        this.trustScoreService.recalculate(transaction.buyer.toString()),
        this.trustScoreService.recalculate(transaction.seller.toString()),
      ]);

      this.notificationsService.notifyAdmins('transaction.disputed', {
        transactionId: transaction._id.toString(),
        buyer: transaction.buyer.toString(),
        seller: transaction.seller.toString(),
        amount: transaction.amount,
        attempts: transaction.failedCodeAttempts,
      });

      throw new BadRequestException(
        'Too many failed attempts — this transaction has been flagged for admin review',
      );
    }

    await transaction.save();
    await this.audit(
      transaction._id.toString(),
      'code_mismatch',
      sellerId,
      oldStatus,
      oldStatus,
      { attempts: transaction.failedCodeAttempts },
    );
    throw new BadRequestException('Incorrect code');
  }

  private generateConfirmationCode(): string {
    // Cryptographically secure — this code gates a real fund release, not
    // just a display value, so Math.random() would be the wrong call here.
    return randomInt(100000, 1000000).toString();
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

  // Requires buyer/seller/listing already populated on the query/document
  // that produced `transaction` — every caller populates before reaching
  // here (see the callers above). rolePlayed is derived from which field
  // we're shaping (buyer vs seller), not stored anywhere. Null-safe: a ref
  // can populate to null for a stale/orphaned document (this dev DB still
  // has pre-fix test data with string-typed ref fields — see CLAUDE.md's
  // ObjectId schema bug note), and that shouldn't 500 the whole response.
  private shapeParty(
    user: PopulatedParty | null,
    rolePlayed: 'buyer' | 'seller',
  ): Record<string, unknown> | null {
    if (!user) return null;
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      status: user.accountStatus,
      rolePlayed,
      slug: user.slug,
      company: user.company,
    };
  }

  private toResponseShape(
    transaction: TransactionDocument,
    requesterId: string,
  ) {
    const buyer = transaction.buyer as unknown as PopulatedParty | null;
    const seller = transaction.seller as unknown as PopulatedParty | null;
    const isBuyer = buyer?._id.toString() === requesterId;
    const showCode =
      isBuyer &&
      [
        TransactionStatus.ESCROW_ACTIVE,
        TransactionStatus.AWAITING_INSPECTION,
      ].includes(transaction.status);

    const obj = transaction.toObject() as unknown as Record<string, unknown>;
    obj.buyer = this.shapeParty(buyer, 'buyer');
    obj.seller = this.shapeParty(seller, 'seller');
    if (!showCode) {
      delete obj.confirmationCode;
    }
    return obj;
  }

  // One period's totals — reused for both the current and prior window.
  private async summarizeTransactions(filter: Record<string, unknown>) {
    const rows = await this.transactionModel.aggregate<{
      _id: null;
      totalTransactions: number;
      completedTransactions: number;
      totalRevenue: number;
      completedAmountSum: number;
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
          completedAmountSum: {
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
    ]);
    const r = rows[0];
    return {
      totalTransactions: r?.totalTransactions ?? 0,
      completedTransactions: r?.completedTransactions ?? 0,
      totalRevenue: Math.round((r?.totalRevenue ?? 0) * 100) / 100,
      avgOrderValue:
        r && r.completedTransactions > 0
          ? Math.round((r.completedAmountSum / r.completedTransactions) * 100) /
            100
          : 0,
    };
  }

  // Live count of disputed/stalled transactions, split by whether they've sat untouched past the SLA cutoff — reuses escrowStalledThresholdDays as the SLA proxy (no dedicated "dispute SLA" setting exists yet, judgment call, flagged) via updatedAt (same proxy-timestamp caveat as getRevenueTrends).
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

  // Backs 6 of the admin Dashboard's 8 "insights" cards — each returned as {value, extra}. disputedTransactions/stalledTransactions.value stay a live, un-scoped snapshot ("how much needs my attention right now"); their .extra is a real SLA-breach count, not a trend. See AdminService.getDashboardInsights() for the other 2 cards and the filter/prior-period math (every filter now has concrete since/until/priorSince/priorUntil bounds).
  async getDashboardInsights(
    since: Date,
    until: Date,
    priorSince: Date,
    priorUntil: Date,
  ): Promise<{
    totalTransactions: { value: number; extra: Trend };
    completedTransactions: { value: number; extra: Trend };
    totalRevenue: { value: number; extra: Trend };
    avgOrderValue: { value: number; extra: Trend };
    disputedTransactions: { value: number; extra: Trend };
    stalledTransactions: { value: number; extra: Trend };
  }> {
    const periodFilter = { createdAt: { $gte: since, $lt: until } };
    const priorFilter = { createdAt: { $gte: priorSince, $lt: priorUntil } };
    const { escrowStalledThresholdDays } = await this.settingsService.get();
    const slaCutoff = new Date(
      Date.now() - escrowStalledThresholdDays * 24 * 60 * 60 * 1000,
    );

    const [current, prior, attention] = await Promise.all([
      this.summarizeTransactions(periodFilter),
      this.summarizeTransactions(priorFilter),
      this.summarizeAttentionStates(slaCutoff),
    ]);

    return {
      totalTransactions: {
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
        extra: pctTrend(
          current.completedTransactions,
          prior.completedTransactions,
          true,
          (pct, dir) => `${pct}% ${dir}`,
          (value) => `${value} this period`,
        ),
      },
      totalRevenue: {
        value: current.totalRevenue,
        extra: pctTrend(
          current.totalRevenue,
          prior.totalRevenue,
          true,
          (pct) => `${pct}% vs prior period`,
          (value) => `${formatNairaShort(value)} this period`,
        ),
      },
      avgOrderValue: {
        value: current.avgOrderValue,
        extra: pctTrend(
          current.avgOrderValue,
          prior.avgOrderValue,
          true,
          (pct) => `${pct}% vs prior period`,
          (value) => `${formatNairaShort(value)} this period`,
        ),
      },
      disputedTransactions: {
        value: attention.disputed.total,
        extra: breachTrend(attention.disputed.breaching, 'breaching SLA'),
      },
      stalledTransactions: {
        value: attention.stalled.total,
        extra: breachTrend(attention.stalled.breaching, 'breaching SLA'),
      },
    };
  }

  // Backs the admin Dashboard revenue-trends chart — always Jan-Dec of the
  // given calendar year, zero-filled. Honesty flag: buckets by `updatedAt`
  // as a proxy for "when it completed" (no dedicated completedAt field),
  // but confirmCode()/adminRelease() set status to COMPLETED immediately
  // before the save that stamps updatedAt, so the two are the same instant.
  // trend[].revenue is commission (platform earnings), unchanged from
  // before; insights.twelveMonthGross/bestMonth/avgPerMonth are built from
  // gross transaction amount instead — a separate figure, not summed from
  // trend[].revenue. totalRemittance is amount minus commission (what
  // sellers were actually paid). Judgment call, flagged: this split wasn't
  // pinned down beyond the screenshot's Gross-Revenue-vs-Commission legend.
  async getRevenueTrends(year: number): Promise<{
    trend: Array<{ year: number; month: string; revenue: number }>;
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

    const trend = MONTH_ABBREVIATIONS.map((month, i) => ({
      year,
      month,
      revenue:
        Math.round((byMonth.get(i + 1)?.commissionAmount ?? 0) * 100) / 100,
    }));

    const grossByMonth = MONTH_NAMES.map((name, i) => ({
      name,
      gross: byMonth.get(i + 1)?.grossAmount ?? 0,
    }));
    const twelveMonthGross = grossByMonth.reduce((sum, m) => sum + m.gross, 0);
    const bestMonth = grossByMonth.reduce((max, m) =>
      m.gross > max.gross ? m : max,
    );
    const totalRemittance = rows.reduce(
      (sum, r) => sum + (r.grossAmount - r.commissionAmount),
      0,
    );

    return {
      trend,
      insights: {
        twelveMonthGross: formatNairaShort(twelveMonthGross),
        bestMonth: `${bestMonth.name} - ${formatNairaShort(bestMonth.gross)}`,
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

  // Requires buyer/seller/listing already populated — same contract as
  // toResponseShape() above.
  private toAdminResponseShape(transaction: TransactionDocument) {
    const obj = transaction.toObject() as unknown as Record<string, unknown>;
    obj.buyer = this.shapeParty(
      transaction.buyer as unknown as PopulatedParty | null,
      'buyer',
    );
    obj.seller = this.shapeParty(
      transaction.seller as unknown as PopulatedParty | null,
      'seller',
    );
    delete obj.confirmationCode;
    return obj;
  }
}
