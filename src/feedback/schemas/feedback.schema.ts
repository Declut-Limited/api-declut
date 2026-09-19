import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { MediaAsset } from '../../listings/schemas/listing.schema';

export type FeedbackDocument = HydratedDocument<Feedback>;

// Predefined, not free text — a fixed dropdown on the client.
export enum FeedbackType {
  SHARE_IMPROVEMENT = 'share_an_improvement',
  REPORT_PROBLEM = 'report_a_problem',
  SHARE_ISSUE = 'share_an_issue',
  OTHERS = 'others',
}

export enum FeedbackStatus {
  NEW = 'new',
  IN_REVIEW = 'in_review',
  RESOLVED = 'resolved',
  ESCALATED = 'escalated',
}

@Schema({ timestamps: true })
export class Feedback {
  // FBK-#### — assigned once at creation via CounterService, sequential
  // (not literally random) for the same collision-avoidance reasoning every
  // other slug in this app uses.
  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({ type: String, enum: FeedbackType, required: true })
  type: FeedbackType;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  feedbackDescription: string;

  @Prop({ default: false })
  canContactMe: boolean;

  // Same MediaAsset shape as Listing.video/Dispute.evidenceVideo — a single
  // Cloudinary upload object, not a plain URL string. Only ever set when
  // type is REPORT_PROBLEM (enforced in CreateFeedbackDto), but left
  // optional at the schema level regardless, same as every other
  // conditionally-required media field in this app.
  @Prop({ type: MediaAsset })
  screenshot?: MediaAsset;

  @Prop({ required: true, min: 1, max: 5 })
  experience: number;

  @Prop({
    type: String,
    enum: FeedbackStatus,
    default: FeedbackStatus.NEW,
    index: true,
  })
  status: FeedbackStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const FeedbackSchema = SchemaFactory.createForClass(Feedback);
