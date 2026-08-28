import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Escrow, EscrowDocument, EscrowStatus } from './schemas/escrow.schema';
import { CounterService } from '../common/counter/counter.service';
import { PopulatedParty, shapeParty } from '../common/utils/party.util';

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

  // buyer/seller/listing are the Escrow row's own denormalized refs, not
  // reached through transaction — platformFee/sellerPayoutAmount are money
  // math already computed on Transaction though, so those are read off a
  // populated transaction rather than duplicated onto Escrow.
  async adminList(page: number, limit: number) {
    const [escrows, total] = await Promise.all([
      this.escrowModel
        .find({})
        .populate('buyer', PARTY_POPULATE_FIELDS)
        .populate('seller', PARTY_POPULATE_FIELDS)
        .populate('listing', LISTING_POPULATE_FIELDS)
        .populate(
          'transaction',
          'commissionAmount sellerPayoutAmount commissionPercentage amount',
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.escrowModel.countDocuments({}),
    ]);

    return {
      results: escrows.map((e) => this.shapeEscrowRow(e)),
      total,
      page,
      limit,
    };
  }

  private shapeEscrowRow(escrow: EscrowDocument): Record<string, unknown> {
    const transaction = escrow.transaction as unknown as {
      _id: Types.ObjectId;
      commissionAmount?: number;
      sellerPayoutAmount?: number;
      commissionPercentage: number;
      amount: number;
    };
    const commissionAmount =
      transaction.commissionAmount ??
      Math.round(
        ((transaction.amount * transaction.commissionPercentage) / 100) * 100,
      ) / 100;
    const sellerPayoutAmount =
      transaction.sellerPayoutAmount ??
      Math.round((transaction.amount - commissionAmount) * 100) / 100;
    const listing = escrow.listing as unknown as {
      _id: Types.ObjectId;
      title: string;
    } | null;

    return {
      transactionId: transaction._id.toString(),
      slug: escrow.slug,
      buyer: shapeParty(
        escrow.buyer as unknown as PopulatedParty | null,
        'buyer',
      ),
      seller: shapeParty(
        escrow.seller as unknown as PopulatedParty | null,
        'seller',
      ),
      product: listing
        ? { id: listing._id.toString(), title: listing.title }
        : null,
      amountPaid: escrow.amount,
      amountHeld: escrow.status === EscrowStatus.HELD ? escrow.amount : 0,
      platformFee: commissionAmount,
      sellerPayoutAmount,
      status: escrow.status,
      createdAt: (escrow as unknown as { createdAt: Date }).createdAt,
    };
  }
}
