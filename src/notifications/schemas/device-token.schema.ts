import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type DeviceTokenDocument = HydratedDocument<DeviceToken>;

export enum DevicePlatform {
  IOS = 'ios',
  ANDROID = 'android',
}

/**
 * One document per device, mirroring RefreshToken's one-doc-per-session
 * shape — a user can have several devices registered at once. `token` is
 * unique (not compound with `user`) so re-registering the same physical
 * device under a different account correctly moves it, rather than leaving
 * a stale registration pointing at the previous owner.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class DeviceToken {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({ required: true, unique: true })
  token: string;

  @Prop({ type: String, enum: DevicePlatform })
  platform?: DevicePlatform;

  createdAt: Date;
}

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);
