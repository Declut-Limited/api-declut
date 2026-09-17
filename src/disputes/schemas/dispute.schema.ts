import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { MediaAsset } from '../../listings/schemas/listing.schema';

export type DisputeDocument = HydratedDocument<Dispute>;

// A seller's escalation of a buyer's report into a formal dispute — created
// once a report has flipped a transaction to REPORTED (see
// TransactionsService.reportActivePurchase()) and the seller chooses to
// contest it rather than refund outright (see
// TransactionsService.sellerRefundReportedPurchase()). Resolution from here
// reuses the existing admin adminRelease()/adminRefund() machinery —
// creating a Dispute moves Transaction.status to DISPUTED, the same status
// those two already operate on. Built 2026-09-16.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Dispute {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  seller: Types.ObjectId;

  // One dispute per transaction — a transaction can only be REPORTED once
  // at a time, so it can only be escalated once too.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
    unique: true,
    index: true,
  })
  transaction: Types.ObjectId;

  // No `listing` field — the Report this points at already has one.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Report', required: true })
  report: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 5000 })
  disputeClaim: string;

  // Same MediaAsset shape Listing.images/video use — the client uploads
  // directly to Cloudinary (GET /media/upload-signature) and forwards the
  // resulting objects here, same as everywhere else in this app. Exactly 2
  // required, per explicit instruction.
  @Prop({
    type: [MediaAsset],
    required: true,
    validate: (v: MediaAsset[]) => v.length === 2,
  })
  evidenceImages: MediaAsset[];

  // Same MediaAsset shape as Listing.video (a single object, not an array)
  // — but required here, unlike Listing.video which is optional.
  @Prop({ type: MediaAsset, required: true })
  evidenceVideo: MediaAsset;

  createdAt: Date;
}

export const DisputeSchema = SchemaFactory.createForClass(Dispute);
