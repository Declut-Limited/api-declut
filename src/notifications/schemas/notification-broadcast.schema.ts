import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type NotificationBroadcastDocument =
  HydratedDocument<NotificationBroadcast>;

// 'manual' is reserved for a future admin-composed broadcast (not wired to any endpoint yet) — kept in the enum to avoid a migration later.
export enum NotificationBroadcastTrigger {
  MANUAL = 'manual',
  CONTENT_PUBLISHED = 'content_published',
}

export enum NotificationBroadcastChannel {
  PUSH = 'push',
  EMAIL = 'email',
  BOTH = 'both',
}

export enum NotificationBroadcastStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// One row per broadcast event (the admin log/table) — distinct from Notification, which is one row per individual recipient, linked via Notification.broadcast.
@Schema({ timestamps: true })
export class NotificationBroadcast {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({
    type: String,
    enum: NotificationBroadcastTrigger,
    required: true,
  })
  trigger: NotificationBroadcastTrigger;

  // Free-text audience description for display — no real segmentation built yet (User has no stored buyer/seller attribute to filter by); see CLAUDE.md.
  @Prop({ required: true, trim: true })
  recipientDescription: string;

  @Prop({ type: String, enum: NotificationBroadcastChannel, required: true })
  channel: NotificationBroadcastChannel;

  @Prop({ type: String, enum: NotificationBroadcastStatus, required: true })
  status: NotificationBroadcastStatus;

  @Prop({ required: true })
  startDate: Date;

  @Prop()
  sentAt?: Date;

  // Set when trigger is 'content_published'; absent for a manual broadcast.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Content' })
  content?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin' })
  createdBy?: Types.ObjectId;

  @Prop({ default: 0 })
  recipientCount: number;

  @Prop({ default: 0 })
  sentCount: number;

  @Prop({ default: 0 })
  failedCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export const NotificationBroadcastSchema = SchemaFactory.createForClass(
  NotificationBroadcast,
);
