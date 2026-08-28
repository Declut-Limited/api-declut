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

  @Prop({
    type: String,
    enum: TransactionStatus,
    default: TransactionStatus.PENDING_PAYMENT,
  })
  status: TransactionStatus;

  @Prop({ required: true, unique: true })
  paystackReference: string;

  @Prop({ unique: true, sparse: true })
  reference?: string;

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
