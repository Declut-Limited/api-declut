import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ReportDocument = HydratedDocument<Report>;

export enum ReportStatus {
  NEW = 'new',
  INVESTIGATING = 'investigating',
  RESOLVED = 'resolved',
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

  // The user who actually filed this dispute — distinct from `user` above, which is the report's target, not its source.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporter: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: String, enum: ReportStatus, default: ReportStatus.NEW })
  status: ReportStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
