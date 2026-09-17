import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ReportDocument = HydratedDocument<Report>;

export enum ReportStatus {
  NEW = 'new',
  INVESTIGATING = 'investigating',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

@Schema({ timestamps: true })
export class Report {
  // RPT-#### — assigned once at creation via CounterService.
  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  title: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  reason: string;

  // A report targets a listing and/or a user — at least one required, checked in ReportsService (no clean schema-level "at least one of").
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Listing' })
  listing?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  user?: Types.ObjectId;

  // The user who actually filed this report — distinct from `user` above, which is the report's target, not its source. Now also the report's creator (users file their own reports directly), so a separate admin-authorship field is no longer meaningful — see the removed `createdBy` below.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporter: Types.ObjectId;

  @Prop({ type: String, enum: ReportStatus, default: ReportStatus.NEW })
  status: ReportStatus;

  // Set once a seller escalates this report into a formal Dispute (see
  // DisputesService.create()/ReportsService.attachDispute()) — a report
  // doesn't store its own transaction reference (the Dispute carries that,
  // linking transaction/listing/report together), so this is the only place
  // the two get tied together. Absent for a report never disputed (resolved
  // by a direct seller refund, or not purchase-related at all). 2026-09-16.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Dispute' })
  sellerDispute?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
