import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type FavoriteDocument = HydratedDocument<Favorite>;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Favorite {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Listing', required: true })
  listing: Types.ObjectId;

  createdAt: Date;
}

export const FavoriteSchema = SchemaFactory.createForClass(Favorite);

// Unique compound index — a user can favorite a given listing at most once.
FavoriteSchema.index({ user: 1, listing: 1 }, { unique: true });
