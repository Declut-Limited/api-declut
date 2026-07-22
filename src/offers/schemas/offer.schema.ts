import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type OfferDocument = HydratedDocument<Offer>;

export enum OfferStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  COUNTERED = 'countered',
  EXPIRED = 'expired',
  WITHDRAWN = 'withdrawn',
}

// Whoever proposed the *current* amount — the other party is the one
// allowed to accept/reject/counter it. Flips on every counter.
export enum OfferProposer {
  BUYER = 'buyer',
  SELLER = 'seller',
}

@Schema({ timestamps: true })
export class Offer {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Listing', required: true, index: true })
  listing: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  buyer: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  seller: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ type: String, enum: OfferStatus, default: OfferStatus.PENDING })
  status: OfferStatus;

  @Prop({ type: String, enum: OfferProposer, required: true })
  proposedBy: OfferProposer;

  // Chains counter-offers into one traceable negotiation thread.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Offer' })
  parentOffer?: Types.ObjectId;

  @Prop({ required: true })
  expiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const OfferSchema = SchemaFactory.createForClass(Offer);
