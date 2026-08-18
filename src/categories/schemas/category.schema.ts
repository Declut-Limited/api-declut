import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type CategoryDocument = HydratedDocument<Category>;

export enum CategoryStatus {
  ACTIVE = 'active',
  HIDDEN = 'hidden',
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Category {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ type: String, enum: CategoryStatus, default: CategoryStatus.ACTIVE })
  status: CategoryStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin' })
  createdBy?: Types.ObjectId;

  createdAt: Date;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
