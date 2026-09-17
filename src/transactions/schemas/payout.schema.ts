import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type PayoutDocument = HydratedDocument<Payout>;

// 'pending' is the normal starting state — Paystack's own transfer call
// almost always comes back 'pending', not an instant final answer.
// TransactionsService's reconciliation sweep moves a pending row to
// 'success'/'failed' once Paystack actually finishes the transfer.
export enum PayoutStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

// One row per seller payout actually attempted against Paystack — created
// only when the buyer triggers the release (TransactionsService.confirmReceipt()),
// per explicit instruction. Mirrors Refund's shape/reasoning but for the
// release-to-seller leg of a transaction rather than the refund-to-buyer leg.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Payout {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
    index: true,
  })
  transaction: Types.ObjectId;

  // The seller being paid.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ type: String, enum: PayoutStatus, default: PayoutStatus.PENDING })
  status: PayoutStatus;

  // Who triggered this release — the buyer (confirmReceipt()) or an admin
  // (adminRelease()). No `ref` and no separate type field (explicit
  // instruction, 2026-09-17) — a payout only ever has these two possible
  // triggering roles, so TransactionsService infers which one by comparing
  // this id against the transaction's own buyer id, rather than storing a
  // redundant flag.
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  triggeredBy: Types.ObjectId;

  @Prop()
  payoutAccountNumber?: string;

  @Prop()
  payoutBankCode?: string;

  // The reference we sent Paystack as the transfer's own reference.
  @Prop({ required: true })
  reference: string;

  // Paystack's own transfer_code, captured from the initiating call's
  // response — what the reconciliation sweep queries GET /transfer/:code
  // against.
  @Prop()
  transferCode?: string;

  // Only set once the reconciliation sweep (or an instant Paystack response)
  // confirms status === success.
  @Prop()
  completedAt?: Date;

  // PYO-#### via CounterService.
  @Prop({ unique: true, sparse: true })
  slug?: string;

  createdAt: Date;
}

export const PayoutSchema = SchemaFactory.createForClass(Payout);
