import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

// visible: default. flagged: an admin has flagged it for attention.
// resolved: an admin reviewed the flag and chose to keep the review as-is —
// lighter-weight than the existing hard-delete moderation action.
export enum ReviewStatus {
  VISIBLE = 'visible',
  FLAGGED = 'flagged',
  RESOLVED = 'resolved',
}

// One-directional — a buyer reviews a seller (a User), anchored on the
// listing they bought rather than the transaction (a listing is only ever
// listed/sold once, so it's the more available/stable identifier on the
// client). Eligibility is checked at write time against a completed
// transaction for this exact listing — see
// TransactionsService.findCompletedPurchase().
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Review {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Listing', required: true })
  listing: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reviewer: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  reviewee: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ trim: true, maxlength: 1000 })
  comment?: string;

  @Prop({ type: String, enum: ReviewStatus, default: ReviewStatus.VISIBLE })
  status: ReviewStatus;

  createdAt: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

// One review per reviewer per listing — a listing is only ever bought once,
// so in practice this means one review ever per listing, but the constraint
// is expressed per-reviewer for the same reason every other uniqueness rule
// in this app is: defense in depth, not just an application-level check.
ReviewSchema.index({ listing: 1, reviewer: 1 }, { unique: true });
