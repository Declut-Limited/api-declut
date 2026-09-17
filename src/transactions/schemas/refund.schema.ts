import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RefundDocument = HydratedDocument<Refund>;

// 'pending' is the normal starting state now — Paystack's own refund call
// almost always comes back 'pending', not an instant final answer.
// TransactionsService's reconciliation sweep is what moves a pending row to
// 'processed'/'failed' once Paystack actually finishes it. 'failed' also
// still covers the call throwing outright.
export enum RefundStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

export type RefundTriggeredByType = 'user' | 'admin' | 'system';

// One row per refund actually attempted against Paystack — created right
// after TransactionsService.refundAndRecord() calls Paystack, whether that
// call succeeded, is still pending, or threw outright. Surfaced on the
// admin transaction detail as `refundInfo`, only when the transaction's own
// status is REFUNDED. Added 2026-09-15, explicit instruction; reworked
// 2026-09-16 to actually track pending/failed state instead of assuming
// success the instant Paystack accepted the request.
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

  @Prop({ type: String, enum: RefundStatus, default: RefundStatus.PENDING })
  status: RefundStatus;

  // Who actually triggered this refund — the buyer (cancel-purchase), the
  // seller (responding to a report), an admin (adminRefund), or the system
  // itself (the inspection-expiry auto-refund sweep). No `ref` — polymorphic,
  // same pattern Notification.recipientType/recipient already uses in this
  // app, since this can point at either User or Admin depending on type.
  @Prop({ type: String, enum: ['user', 'admin', 'system'], required: true })
  triggeredByType: RefundTriggeredByType;

  // Absent only when triggeredByType is 'system'.
  @Prop({ type: MongooseSchema.Types.ObjectId })
  triggeredBy?: Types.ObjectId;

  // Best-effort, from the buyer's own BankAccount if one exists on file —
  // Paystack's refund itself reverses to the original payment source, not a
  // chosen bank account, so these are informational context only, not
  // necessarily where the money actually routed.
  @Prop()
  payoutAccountNumber?: string;

  @Prop()
  payoutBankCode?: string;

  // Only set once the reconciliation sweep (or an instant Paystack response)
  // confirms status === processed — not set just because the call was made.
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

  // Paystack's own refund id, captured from the initiating call's response —
  // what the reconciliation sweep actually queries GET /refund/:id against.
  // Absent if the initiating call threw before Paystack ever returned one.
  @Prop()
  refundCode?: string;

  createdAt: Date;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
