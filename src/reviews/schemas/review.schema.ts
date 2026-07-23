import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

export enum ReviewerRole {
  BUYER = 'buyer',
  SELLER = 'seller',
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Review {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
    index: true,
  })
  transaction: Types.ObjectId;

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

  // Derived server-side from which party the reviewer is on the
  // transaction — never trusted from the request body, so a reviewer can't
  // misrepresent which side of the deal they were on.
  @Prop({ type: String, enum: ReviewerRole, required: true })
  role: ReviewerRole;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ trim: true, maxlength: 1000 })
  comment?: string;

  createdAt: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

// One review per reviewer per transaction — buyer and seller can each leave
// exactly one review on a given deal.
ReviewSchema.index({ transaction: 1, reviewer: 1 }, { unique: true });
