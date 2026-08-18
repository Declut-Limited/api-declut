import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ArticleDocument = HydratedDocument<Article>;

export enum ArticleStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  RETIRED = 'retired',
}

@Schema({ timestamps: true })
export class Article {
  @Prop({ required: true, trim: true, maxlength: 160 })
  title: string;

  // Content-based, not sequential — slugify(title), same reasoning as
  // Category (a human-meaningful, low-volume, admin-authored entity, unlike
  // Users/Listings/Reports which use CounterService sequences).
  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ required: true, maxlength: 20000 })
  body: string;

  @Prop({ type: String, enum: ArticleStatus, default: ArticleStatus.DRAFT })
  status: ArticleStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: Types.ObjectId;

  @Prop()
  publishedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const ArticleSchema = SchemaFactory.createForClass(Article);
