import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;

export enum TransactionStatus {
  PENDING_PAYMENT = 'pending_payment',
  ESCROW_ACTIVE = 'escrow_active',
  AWAITING_INSPECTION = 'awaiting_inspection',
  COMPLETED = 'completed',
  STALLED = 'stalled',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
}

@Schema({ timestamps: true })
export class Transaction {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true,
  })
  listing: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  buyer: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  seller: Types.ObjectId;

  // The agreed price — listing.price at checkout.
  @Prop({ required: true, min: 0 })
  amount: number;

  // Snapshotted at creation so a later admin change to the platform-wide
  // commissionPercentage setting never retroactively changes an in-flight
  // or historical transaction.
  @Prop({ required: true })
  commissionPercentage: number;

  // Computed at release time (amount * commissionPercentage / 100).
  @Prop()
  commissionAmount?: number;

  @Prop()
  sellerPayoutAmount?: number;

  @Prop({
    type: String,
    enum: TransactionStatus,
    default: TransactionStatus.PENDING_PAYMENT,
  })
  status: TransactionStatus;

  @Prop({ required: true, unique: true })
  paystackReference: string;

  // Human-readable reference for the admin UI — TXN-{year}-{5-digit},
  // generated once at creation via CounterService (separate from the
  // internal paystackReference above). Sparse since transactions created
  // before this field existed have none.
  @Prop({ unique: true, sparse: true })
  reference?: string;

  // Set alongside escrowActiveAt (webhook handler) as
  // escrowActiveAt + escrowStalledThresholdDays at that moment — a snapshot
  // for display, not re-derived live, so a later admin change to the
  // platform-wide threshold doesn't retroactively move an in-flight
  // transaction's displayed deadline (same snapshotting rule already
  // applied to commissionPercentage).
  @Prop()
  inspectionDeadlineAt?: Date;

  // Judgment call: stored in plaintext, not hashed. Unlike a password or
  // refresh token, the buyer needs to retrieve this on demand (potentially
  // days later, at the physical meetup) — a one-way hash would make that
  // impossible. Mitigated by: only ever returned to the buyer specifically
  // (never the seller, never any admin/list endpoint), never logged, and
  // cleared once the transaction reaches a terminal state.
  @Prop()
  confirmationCode?: string;

  @Prop({ default: 0 })
  failedCodeAttempts: number;

  // When escrow_active was reached — the stalled-sweep threshold counts
  // from here, not from createdAt (checkout can be initiated well before
  // payment actually clears).
  @Prop()
  escrowActiveAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
