import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RefundDocument = HydratedDocument<Refund>;

// 'failed' exists for completeness but should be rare — Paystack's own
// refund call either succeeds or throws before this record is even created
// (see TransactionsService.refundAndRecord()); 'processed' is the expected
// outcome nearly every time.
export enum RefundStatus {
  PROCESSED = 'processed',
  FAILED = 'failed',
}

// One row per refund actually attempted against Paystack — created right
// after TransactionsService.refundAndRecord() resolves the Paystack call,
// whether that call succeeded or failed. Surfaced on the admin transaction
// detail as `refundInfo`, only when the transaction's own status is
// REFUNDED. Added 2026-09-15, explicit instruction.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Refund {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
    index: true,
  })
  transaction: Types.ObjectId;

  // The buyer being refunded — always the transaction's own buyer.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ trim: true })
  reason?: string;

  @Prop({ type: String, enum: RefundStatus, default: RefundStatus.PROCESSED })
  status: RefundStatus;

  // Set only when an admin triggers the refund (adminRefund()) — absent for
  // a buyer-initiated self-serve refund (cancelPurchaseWithRefund()).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin' })
  approvedBy?: Types.ObjectId;

  // Best-effort, from the buyer's own BankAccount if one exists on file —
  // Paystack's refund itself reverses to the original payment source, not a
  // chosen bank account, so these are informational context only, not
  // necessarily where the money actually routed.
  @Prop()
  payoutAccountNumber?: string;

  @Prop()
  payoutBankCode?: string;

  @Prop()
  refundedAt?: Date;

  // RFD-#### via CounterService — sequential, not literally random, same
  // reasoning as every other slug in this app (collision risk at this app's
  // volume).
  @Prop({ unique: true, sparse: true })
  slug?: string;

  // The reference used to request the refund from Paystack — this app's
  // Transaction.reference doubles as both the original-charge and
  // refund-request key (PaystackService.refund() sends it as `transaction`).
  @Prop({ required: true })
  reference: string;

  createdAt: Date;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
