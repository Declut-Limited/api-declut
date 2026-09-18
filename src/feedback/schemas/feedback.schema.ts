import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { MediaAsset } from '../../listings/schemas/listing.schema';

export type FeedbackDocument = HydratedDocument<Feedback>;

// Predefined, not free text — a fixed dropdown on the client.
export enum FeedbackCategory {
  SHARE_IMPROVEMENT = 'share_an_improvement',
  REPORT_PROBLEM = 'report_a_problem',
  SHARE_ISSUE = 'share_an_issue',
  OTHERS = 'others',
}

@Schema({ timestamps: true })
export class Feedback {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({ type: String, enum: FeedbackCategory, required: true })
  category: FeedbackCategory;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  moreDescription: string;

  @Prop({ default: false })
  canContactMe: boolean;

  // Same MediaAsset shape as Listing.video/Dispute.evidenceVideo — a single
  // Cloudinary upload object, not a plain URL string. Only ever set when
  // category is REPORT_PROBLEM (enforced in CreateFeedbackDto), but left
  // optional at the schema level regardless, same as every other
  // conditionally-required media field in this app.
  @Prop({ type: MediaAsset })
  screenshot?: MediaAsset;

  @Prop({ required: true, min: 1, max: 5 })
  experience: number;

  createdAt: Date;
  updatedAt: Date;
}

export const FeedbackSchema = SchemaFactory.createForClass(Feedback);
