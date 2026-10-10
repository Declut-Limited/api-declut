import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ListingDelistDocument = HydratedDocument<ListingDelist>;

export enum ListingDelistSource {
  // PATCH /admin/listings/:id/delist — reason picked by the admin.
  ADMIN = 'admin',
  // adminDelistFromDispute() — buyer's report upheld, reason set automatically.
  DISPUTE = 'dispute',
}

// One row per delist — its own record rather than fields on Listing, same
// "moderation lives beside the listing, not on it" shape as Report. Never
// cleared on relist, so earlier delists stay on file; the seller's
// GET /listings/:id/delist-reason reads the latest. Added 2026-10-10.
// timestamps: createdAt doubles as the delisted date.
@Schema({ timestamps: true })
export class ListingDelist {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true,
  })
  listing: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  seller: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  delistedBy: Types.ObjectId;

  @Prop({ type: String, enum: ListingDelistSource, required: true })
  source: ListingDelistSource;

  @Prop({ required: true, trim: true })
  reason: string;

  @Prop({ type: String, default: null, trim: true, maxlength: 500 })
  note: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export const ListingDelistSchema = SchemaFactory.createForClass(ListingDelist);
