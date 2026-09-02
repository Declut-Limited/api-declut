import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ListingViewDocument = HydratedDocument<ListingView>;

// One row per (user, listing) pair — lastViewedAt drives the 1-hour dedup
// window in ListingsService.registerView(). Not an append-only view log;
// updated in place on each subsequent counted view.
@Schema()
export class ListingView {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  })
  listing: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true })
  lastViewedAt: Date;
}

export const ListingViewSchema = SchemaFactory.createForClass(ListingView);

// Unique compound index — one dedup row per (user, listing) pair.
ListingViewSchema.index({ user: 1, listing: 1 }, { unique: true });
