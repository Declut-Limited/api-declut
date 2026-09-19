import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Escrow, EscrowDocument, EscrowStatus } from './schemas/escrow.schema';
import { CounterService } from '../common/counter/counter.service';
import { PopulatedParty, shapeParty } from '../common/utils/party.util';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { DateRangeDto } from '../common/dto/date-range.dto';
import { toCsv } from '../common/utils/csv.util';

const PARTY_POPULATE_FIELDS = 'name email accountStatus slug company';
const LISTING_POPULATE_FIELDS = 'title';

@Injectable()
export class EscrowService {
  constructor(
    @InjectModel(Escrow.name) private escrowModel: Model<EscrowDocument>,
    private readonly counterService: CounterService,
  ) {}

  // Called from TransactionsService's webhook handler the moment payment is
  // verified — one Escrow per Transaction. Returns the new Escrow's id so
  // the caller can write it back onto Transaction.escrow (the two documents
  // reference each other, populatable from either side).
  async createForTransaction(params: {
    transactionId: Types.ObjectId;
    listingId: Types.ObjectId;
    buyerId: Types.ObjectId;
    sellerId: Types.ObjectId;
    amount: number;
  }): Promise<Types.ObjectId> {
    const escrow = await this.escrowModel.create({
      slug: await this.counterService.nextSlug('escrow', 'ESC', 4),
      transaction: params.transactionId,
      listing: params.listingId,
      buyer: params.buyerId,
      seller: params.sellerId,
      amount: params.amount,
      status: EscrowStatus.HELD,
    });
    return escrow._id;
  }

  // No-op if no Escrow row exists for this transaction (e.g. it never left
  // pending_payment, so createForTransaction() was never called).
  async updateStatusForTransaction(
    transactionId: string,
    status: EscrowStatus,
  ): Promise<void> {
    await this.escrowModel.updateOne(
      { transaction: transactionId },
      { status },
    );
  }

  // Raw, unpopulated — backs the admin escrow detail view, built in
  // TransactionsService (which already injects this service; the reverse
  // isn't true, so the detail-building logic has to live over there rather
  // than here — see the "escrow detail" section of CLAUDE.md for why).
  // Same id-or-slug dispatch every other admin detail lookup in this app uses.
  async findRawByIdOrSlug(idOrSlug: string): Promise<EscrowDocument> {
    const filter = isValidObjectId(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: idOrSlug };
    const escrow = await this.escrowModel.findOne(filter).exec();
    if (!escrow) {
      throw new NotFoundException('Escrow not found');
    }
    return escrow;
  }

  async adminList(
    page: number,
    limit: number,
    dateRange: DateRangeDto = {},
    status?: EscrowStatus,
  ) {
    const filter = {
      ...(status ? { status } : {}),
      ...buildDateRangeFilter(dateRange),
    };
    const [escrows, total] = await Promise.all([
      this.escrowModel
        .find(filter)
        .populate('buyer', PARTY_POPULATE_FIELDS)
        .populate('seller', PARTY_POPULATE_FIELDS)
        .populate('listing', LISTING_POPULATE_FIELDS)
        .populate(
          'transaction',
          'reference commissionAmount sellerPayoutAmount commissionPercentage amount',
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.escrowModel.countDocuments(filter),
    ]);

    return {
      results: escrows.map((e) => this.shapeEscrowRow(e)),
      total,
      page,
      limit,
    };
  }

  // Unpaginated, same status/date-range filter as adminList(), flattened for
  // CSV — same convention every other export in this app follows.
  async exportCsv(
    dateRange: DateRangeDto = {},
    status?: EscrowStatus,
  ): Promise<string> {
    const filter = {
      ...(status ? { status } : {}),
      ...buildDateRangeFilter(dateRange),
    };
    const escrows = await this.escrowModel
      .find(filter)
      .populate('buyer', PARTY_POPULATE_FIELDS)
      .populate('seller', PARTY_POPULATE_FIELDS)
      .populate('listing', LISTING_POPULATE_FIELDS)
      .populate(
        'transaction',
        'reference commissionAmount sellerPayoutAmount commissionPercentage amount',
      )
      .sort({ createdAt: -1 })
      .exec();

    const rows = escrows.map((e) => {
      const shaped = this.shapeEscrowRow(e);
      const buyer = shaped.buyer as { name?: string; email?: string } | null;
      const seller = shaped.seller as { name?: string; email?: string } | null;
      const listing = shaped.listing as { title?: string } | null;
      const transaction = shaped.transaction as { reference?: string } | null;
      return {
        slug: shaped.slug,
        transactionReference: transaction?.reference ?? '',
        buyerName: buyer?.name ?? '',
        buyerEmail: buyer?.email ?? '',
        sellerName: seller?.name ?? '',
        sellerEmail: seller?.email ?? '',
        listingTitle: listing?.title ?? '',
        amountPaid: shaped.amountPaid,
        amountHeld: shaped.amountHeld,
        platformFee: shaped.platformFee,
        sellerPayoutAmount: shaped.sellerPayoutAmount,
        status: shaped.status,
        createdAt: shaped.createdAt,
      };
    });

    return toCsv(rows, [
      'slug',
      'transactionReference',
      'buyerName',
      'buyerEmail',
      'sellerName',
      'sellerEmail',
      'listingTitle',
      'amountPaid',
      'amountHeld',
      'platformFee',
      'sellerPayoutAmount',
      'status',
      'createdAt',
    ]);
  }

  private shapeEscrowRow(escrow: EscrowDocument): Record<string, unknown> {
    // A dangling reference — the linked Transaction document no longer
    // exists (only ever possible via a direct DB operation, e.g. leftover
    // test-data cleanup that removed a Transaction but not its Escrow) —
    // used to crash this entire list. Degrade to null/0 for that one row
    // instead, same "don't let one broken row take down the page" pattern
    // already used for a dangling listing ref elsewhere in this app.
    const transaction = escrow.transaction as unknown as {
      _id: Types.ObjectId;
      reference?: string;
      commissionAmount?: number;
      sellerPayoutAmount?: number;
      commissionPercentage: number;
      amount: number;
    } | null;
    const commissionAmount = transaction
      ? (transaction.commissionAmount ??
        Math.round(
          ((transaction.amount * transaction.commissionPercentage) / 100) * 100,
        ) / 100)
      : 0;
    const sellerPayoutAmount = transaction
      ? (transaction.sellerPayoutAmount ??
        Math.round((transaction.amount - commissionAmount) * 100) / 100)
      : 0;
    const listing = escrow.listing as unknown as {
      _id: Types.ObjectId;
      title: string;
    } | null;

    return {
      _id: escrow._id.toString(),
      transaction: transaction
        ? { _id: transaction._id.toString(), reference: transaction.reference }
        : null,
      slug: escrow.slug,
      buyer: shapeParty(
        escrow.buyer as unknown as PopulatedParty | null,
        'buyer',
      ),
      seller: shapeParty(
        escrow.seller as unknown as PopulatedParty | null,
        'seller',
      ),
      listing: listing
        ? { id: listing._id.toString(), title: listing.title }
        : null,
      amountPaid: escrow.amount,
      // Frozen money hasn't left the platform either — held and frozen both count.
      amountHeld:
        escrow.status === EscrowStatus.HELD ||
        escrow.status === EscrowStatus.FROZEN
          ? escrow.amount
          : 0,
      platformFee: commissionAmount,
      sellerPayoutAmount,
      status: escrow.status,
      createdAt: (escrow as unknown as { createdAt: Date }).createdAt,
    };
  }
}
