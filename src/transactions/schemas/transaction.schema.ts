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

// Escrow itself (id/status/money-holding) lives in its own Escrow
// collection (schemas/escrow.schema.ts) — a Transaction is not an Escrow,
// it's the record an Escrow gets created from once payment is verified.
export enum InspectionStatus {
  AWAITING = 'awaiting',
  COMPLETED = 'completed',
  REFUNDED = 'refunded',
  DISPUTED = 'disputed',
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

  // Paystack's own processing fee, in Naira — the surplus the buyer actually paid above `amount`
  // (listing price), collected because the buyer's chosen payment channel grossed Paystack's fee
  // onto them rather than it being deducted from settlement. Computed at webhook time as
  // (amount Paystack actually received) − (amount). Zero for channels that don't gross the fee
  // onto the payer. The buyer bears this — separate from commissionAmount (Declut's own cut,
  // taken from the seller's side at release, not from the buyer at checkout).
  @Prop({ default: 0 })
  paystackFee?: number;

  @Prop({
    type: String,
    enum: TransactionStatus,
    default: TransactionStatus.PENDING_PAYMENT,
  })
  status: TransactionStatus;

  // Doubles as the value sent to Paystack as its own `reference` param at
  // checkout — the webhook's data.reference is matched against this same
  // field, so this is both the human-facing TXN-YYYY-##### id and the
  // Paystack-facing key. Generated before the Paystack call (not after),
  // so a failed checkout attempt can leave a gap in the sequence.
  @Prop({ required: true, unique: true })
  reference: string;

  // Set once, at the same moment EscrowService.createForTransaction() creates
  // the Escrow row (payment verified) — mirrors Escrow.transaction so either
  // side can be reached from the other via .populate(). Absent for a
  // transaction still at pending_payment, which never got an Escrow.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Escrow' })
  escrow?: Types.ObjectId;

  @Prop({
    type: String,
    enum: InspectionStatus,
    default: InspectionStatus.AWAITING,
  })
  inspectionStatus: InspectionStatus;

  // Set once, when escrow becomes active — now + inspectionWindow.inspectionPeriod at that moment. A snapshot for display, not re-derived live, so a later admin change to the platform-wide setting doesn't retroactively move an in-flight transaction's deadline.
  @Prop()
  inspectionDeadlineAt?: Date;

  @Prop()
  confirmationCode?: string;

  @Prop({ default: 0 })
  failedCodeAttempts: number;

  createdAt: Date;
  updatedAt: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
