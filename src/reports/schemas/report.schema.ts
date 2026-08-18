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

  // A report targets a listing and/or a user — at least one is required,
  // checked in ReportsService rather than at the schema level (Mongoose
  // doesn't have a clean "at least one of" validator).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Listing' })
  listing?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  user?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: String, enum: ReportStatus, default: ReportStatus.NEW })
  status: ReportStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
