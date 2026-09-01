import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ListingDocument = HydratedDocument<Listing>;

export enum ListingCondition {
  NEW = 'new',
  NEATLY_USED = 'neatly_used',
}

export enum ListingStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
  FLAGGED = 'flagged',
  SOLD = 'sold',
  DELISTED = 'delisted',
}

@Schema({ _id: false })
class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point', required: true })
  type: 'Point';

  // [lng, lat] — GeoJSON order, not [lat, lng].
  @Prop({ type: [Number], required: true })
  coordinates: [number, number];
}

@Schema({ _id: false })
class PriceHistoryEntry {
  @Prop({ required: true })
  price: number;

  @Prop({ required: true })
  changedAt: Date;
}

@Schema({ _id: false })
class ListingSpecs {
  @Prop()
  brand?: string;
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

  // References Category (src/categories) — was a fixed string enum until
  // the Categories module made it admin-managed.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Category',
    required: true,
    index: true,
  })
  category: Types.ObjectId;

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

  // Computed server-side as "${city}, ${state}" — not client-supplied.
  @Prop({ required: true, trim: true, maxlength: 200 })
  locationLabel: string;

  @Prop({ trim: true, maxlength: 200 })
  address?: string;

  @Prop({ trim: true, maxlength: 100, index: true })
  state?: string;

  @Prop({ trim: true, maxlength: 100, index: true })
  city?: string;

  @Prop({ trim: true, maxlength: 100, index: true })
  area?: string;

  // Cloudinary URL, same never-touch-the-bytes pattern as images — a single video, not an array.
  @Prop()
  video?: string;

  @Prop({ default: false })
  hasDefect: boolean;

  @Prop({ type: String, default: null })
  defectDescription: string | null;

  @Prop({ type: String, enum: ListingStatus, default: ListingStatus.ACTIVE })
  status: ListingStatus;

  // LST-#### — assigned once at creation via CounterService.
  @Prop({ unique: true, sparse: true })
  slug?: string;

  @Prop({ default: 0 })
  views: number;

  // Kept in sync from FavoritesService.add()/remove() — the trigger point
  // for "someone saved this listing" already exists there.
  @Prop({ default: 0 })
  saves: number;

  @Prop({ type: [PriceHistoryEntry], default: [] })
  priceHistory: PriceHistoryEntry[];

  // condition (above) stays top-level, not duplicated in here.
  @Prop({ type: ListingSpecs })
  specs?: ListingSpecs;

  createdAt: Date;
  updatedAt: Date;
}

export const ListingSchema = SchemaFactory.createForClass(Listing);

ListingSchema.index({ location: '2dsphere' });
ListingSchema.index({ title: 'text', description: 'text' });
