import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ListingDocument = HydratedDocument<Listing>;

// Not specified in CLAUDE.md — reasonable defaults for a pre-owned household
// items marketplace, flagged as a judgment call to revisit if you want a
// different taxonomy.
export enum ListingCategory {
  FURNITURE = 'furniture',
  ELECTRONICS = 'electronics',
  APPLIANCES = 'appliances',
  KITCHENWARE = 'kitchenware',
  CLOTHING = 'clothing',
  DECOR = 'decor',
  BOOKS = 'books',
  OTHER = 'other',
}

export enum ListingCondition {
  NEW = 'new',
  LIKE_NEW = 'like_new',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
}

export enum ListingStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
}

@Schema({ _id: false })
class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point', required: true })
  type: 'Point';

  // [lng, lat] — GeoJSON order, not [lat, lng].
  @Prop({ type: [Number], required: true })
  coordinates: [number, number];
}

/**
 * timestamps: true gives createdAt/updatedAt automatically. The 2dsphere
 * index on `location` powers radius search; the text index on
 * title+description powers keyword search — see ListingsService for how
 * they combine.
 */
@Schema({ timestamps: true })
export class Listing {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  seller: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 120 })
  title: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  description: string;

  @Prop({ type: String, enum: ListingCategory, required: true })
  category: ListingCategory;

  @Prop({ type: String, enum: ListingCondition, required: true })
  condition: ListingCondition;

  @Prop({ required: true, min: 0 })
  price: number;

  // Cloudinary URLs — the mobile app uploads directly to Cloudinary using a
  // signed payload from GET /listings/upload-signature, then sends us the
  // resulting URLs. We never receive or store raw image bytes.
  @Prop({
    type: [String],
    required: true,
    validate: (v: string[]) => v.length > 0,
  })
  images: string[];

  @Prop({ type: GeoPoint, required: true })
  location: GeoPoint;

  @Prop({ required: true, trim: true, maxlength: 200 })
  locationLabel: string;

  @Prop({ type: String, enum: ListingStatus, default: ListingStatus.ACTIVE })
  status: ListingStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const ListingSchema = SchemaFactory.createForClass(Listing);

ListingSchema.index({ location: '2dsphere' });
ListingSchema.index({ title: 'text', description: 'text' });
