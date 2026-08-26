import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ContentDocument = HydratedDocument<Content>;

export enum ContentType {
  FAQ = 'faq',
  BANNER = 'banner',
  PAGE = 'page',
}

export enum ContentStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

// Admin-authored CMS blocks (FAQ/banner/page). slug is CNT-#### via CounterService (sequential, not random — matches RPT/USR/LST-####).
@Schema({ timestamps: true })
export class Content {
  @Prop({ required: true, trim: true, maxlength: 160 })
  title: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ type: String, enum: ContentType, required: true })
  contentType: ContentType;

  @Prop({ type: String, enum: ContentStatus, default: ContentStatus.DRAFT })
  status: ContentStatus;

  @Prop({ required: true, maxlength: 20000 })
  body: string;

  // Free text (e.g. "Home Page - Top Banner") — no fixed placement list was given.
  @Prop({ required: true, trim: true, maxlength: 160 })
  whereToAppear: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const ContentSchema = SchemaFactory.createForClass(Content);
