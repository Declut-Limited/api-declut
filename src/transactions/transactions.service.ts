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

interface PaystackWebhookPayload {
  event: string;
  data?: { reference?: string };
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

    return this.toResponseShape(transaction, buyerId);
  }

  async findForUser(transactionId: string, userId: string) {
    const transaction = await this.findRaw(transactionId);
    if (
      transaction.buyer.toString() !== userId &&
      transaction.seller.toString() !== userId
    ) {
      throw new ForbiddenException('You are not a party to this transaction');
    }
    return this.toResponseShape(transaction, userId);
  }

  async listForUser(userId: string, page = 1, limit = 20) {
    const results = await this.transactionModel
      .find({ $or: [{ buyer: userId }, { seller: userId }] })
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

  async adminFindById(transactionId: string) {
    const transaction = await this.findRaw(transactionId);
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
      this.listingsService.adminFindById(transaction.listing.toString()),
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
      buyer: buyer
        ? { id: buyer._id.toString(), name: buyer.name, email: buyer.email }
        : null,
      seller: seller
        ? { id: seller._id.toString(), name: seller.name, email: seller.email }
        : null,
      listing: {
        id: listing._id.toString(),
        title: listing.title,
        slug: listing.slug,
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

  private toResponseShape(
    transaction: TransactionDocument,
    requesterId: string,
  ) {
    const obj = transaction.toObject();
    const isBuyer = transaction.buyer.toString() === requesterId;
    const showCode =
      isBuyer &&
      [
        TransactionStatus.ESCROW_ACTIVE,
        TransactionStatus.AWAITING_INSPECTION,
      ].includes(transaction.status);
    if (!showCode) {
      delete obj.confirmationCode;
    }
    return obj;
  }

  // Backs the admin Dashboard "insights" cards. `since` narrows the
  // transaction-volume/revenue figures to a period; disputed/stalled counts
  // are always a live, un-scoped snapshot rather than "how many became
  // disputed in this period" — a judgment call, since what an admin
  // actually wants from those two numbers is "how much needs my attention
  // right now," not a historical rate. See AdminService.getDashboardInsights().
  async getDashboardInsights(since?: Date): Promise<{
    totalTransactions: number;
    completedTransactions: number;
    totalRevenue: number;
    avgOrderValue: number;
    disputedTransactions: number;
    stalledTransactions: number;
  }> {
    const periodFilter = since ? { createdAt: { $gte: since } } : {};

    const [periodRows, liveRows] = await Promise.all([
      this.transactionModel.aggregate<{
        _id: null;
        totalTransactions: number;
        completedTransactions: number;
        totalRevenue: number;
        completedAmountSum: number;
      }>([
        { $match: periodFilter },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            completedTransactions: {
              $sum: {
                $cond: [
                  { $eq: ['$status', TransactionStatus.COMPLETED] },
                  1,
                  0,
                ],
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
      ]),
      this.transactionModel.aggregate<{
        _id: TransactionStatus;
        count: number;
      }>([
        {
          $match: {
            status: {
              $in: [TransactionStatus.DISPUTED, TransactionStatus.STALLED],
            },
          },
        },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const p = periodRows[0];
    const disputedTransactions =
      liveRows.find((r) => r._id === TransactionStatus.DISPUTED)?.count ?? 0;
    const stalledTransactions =
      liveRows.find((r) => r._id === TransactionStatus.STALLED)?.count ?? 0;

    return {
      totalTransactions: p?.totalTransactions ?? 0,
      completedTransactions: p?.completedTransactions ?? 0,
      totalRevenue: Math.round((p?.totalRevenue ?? 0) * 100) / 100,
      avgOrderValue:
        p && p.completedTransactions > 0
          ? Math.round((p.completedAmountSum / p.completedTransactions) * 100) /
            100
          : 0,
      disputedTransactions,
      stalledTransactions,
    };
  }

  // Backs the admin Dashboard revenue-trends chart — monthly commission
  // revenue for the last `monthsBack` months, zero-filled so a month with
  // no completed transactions still appears as a point rather than a gap.
  // Honesty flag: buckets by `updatedAt` on a completed transaction as a
  // proxy for "when it completed" — there's no dedicated completedAt field,
  // but confirmCode()/adminRelease() both set status to COMPLETED
  // immediately before the save that stamps updatedAt, so in practice the
  // two are the same instant for every transaction that reaches this state.
  async getMonthlyRevenue(
    monthsBack: number,
  ): Promise<Array<{ year: number; month: number; revenue: number }>> {
    const now = new Date();
    const buckets: { year: number; month: number }[] = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }
    const since = new Date(buckets[0].year, buckets[0].month - 1, 1);

    const rows = await this.transactionModel.aggregate<{
      _id: { year: number; month: number };
      revenue: number;
    }>([
      {
        $match: {
          status: TransactionStatus.COMPLETED,
          updatedAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$updatedAt' },
            month: { $month: '$updatedAt' },
          },
          revenue: { $sum: '$commissionAmount' },
        },
      },
    ]);
    const revenueMap = new Map(
      rows.map((r) => [`${r._id.year}-${r._id.month}`, r.revenue]),
    );

    return buckets.map((b) => ({
      year: b.year,
      month: b.month,
      revenue:
        Math.round((revenueMap.get(`${b.year}-${b.month}`) ?? 0) * 100) / 100,
    }));
  }

  private toAdminResponseShape(transaction: TransactionDocument) {
    const obj = transaction.toObject();
    delete obj.confirmationCode;
    return obj;
  }
}
