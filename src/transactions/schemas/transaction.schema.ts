import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;

// STALLED removed 2026-09-13, explicit instruction — a lapsed inspection
// deadline now auto-cancels and refunds the transaction directly (see
// sweepEndedInspectionPeriods()) instead of flagging it for manual admin
// review. DISPUTED is the only status left that adminRelease()/
// adminRefund() operate on.
export enum TransactionStatus {
  PENDING_PAYMENT = 'pending_payment',
  ESCROW_ACTIVE = 'escrow_active',
  AWAITING_INSPECTION = 'awaiting_inspection',
  COMPLETED = 'completed',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
}

// Escrow itself (id/status/money-holding) lives in its own Escrow
// collection (schemas/escrow.schema.ts) — a Transaction is not an Escrow,
// it's the record an Escrow gets created from once payment is verified.
// Narrowed to exactly these 3 values 2026-09-13, explicit instruction ("no
// more no less") — REFUNDED/DISPUTED collapsed into FAILED, since from the
// inspection's own point of view both used to mean the same thing: the
// inspection never reached a normal completion.
export enum InspectionStatus {
  AWAITING = 'awaiting',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Only these 2 buckets, per explicit instruction — Paystack's own channel
// can be card/bank/ussd/qr/mobile_money/bank_transfer/eft; every non-card
// channel is folded into BANK_TRANSFER at webhook time (see
// handlePaystackWebhook()), not modeled as its own enum value.
export enum PaymentMethod {
  BANK_TRANSFER = 'bank_transfer',
  CARD = 'card',
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

  // The gateway's own processing fee, in Naira — the surplus the buyer actually paid above
  // `amount` (listing price), collected because the buyer's chosen payment channel grossed the
  // gateway's fee onto them rather than it being deducted from settlement. Computed at webhook
  // time as (amount the gateway actually received) − (amount). Zero for channels that don't gross
  // the fee onto the payer. The buyer bears this — separate from commissionAmount (Declut's own
  // cut, taken from the seller's side at release, not from the buyer at checkout). Renamed from
  // paystackFee 2026-09-15, explicit instruction, alongside gateway/paymentMethod below.
  @Prop({ default: 0 })
  gatewayProcessingFee?: number;

  // Both added 2026-09-15, explicit instruction ("we need to start collecting the transaction
  // means from paystack"). gateway is a fixed literal for now (Paystack is the only integration
  // this app has) but stored rather than hardcoded, since a future second gateway would need to
  // tell transactions apart by this field. paymentMethod is read from Paystack's real webhook
  // channel — see handlePaystackWebhook().
  @Prop({ default: 'paystack' })
  gateway: string;

  @Prop({
    type: String,
    enum: PaymentMethod,
    default: PaymentMethod.BANK_TRANSFER,
  })
  paymentMethod: PaymentMethod;

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

  // Whether the buyer has used their one-time inspection extension — once true, add-inspection-extension refuses a second one.
  @Prop({ default: false })
  inspectionExtended: boolean;

  // Snapshotted from AppSettings.inspectionWindow.maxExtensionPeriod at the moment the extension was granted, in days.
  @Prop()
  inspectionExtendedBy?: number;

  // inspectionDeadlineAt + inspectionExtendedBy days — the real deadline once extended, set only by a successful add-inspection-extension call.
  @Prop()
  inspectionExtensionEndDate?: Date;

  // Set by the hourly sweep once the effective deadline (inspectionExtensionEndDate if extended, else inspectionDeadlineAt) has passed. add-inspection-extension refuses once this is true — an extension can only be requested while the window is still open.
  @Prop({ default: false })
  inspectionPeriodEnded: boolean;

  // Incremented each time an admin successfully sends a manual inspection
  // reminder (POST /admin/transactions/:id/send-inspection-reminder). Shown
  // as null on the admin detail response when the buyer's own
  // inspectionReminders notification setting is off — added 2026-09-15,
  // explicit instruction.
  @Prop({ default: 0 })
  inspectionReminderCount: number;

  // Set once, only inside confirmReceipt() — the moment the buyer confirms
  // they received the item and their own action releases funds to the
  // seller. Never set by adminRelease(), cancelPurchaseWithRefund(), or the
  // automatic expiry-refund — those aren't the buyer's own inspection
  // confirmation. Added 2026-09-15, explicit instruction.
  @Prop()
  buyerInspectionConfirmedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
