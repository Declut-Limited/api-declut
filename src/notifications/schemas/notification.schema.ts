import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationRecipientType {
  USER = 'user',
  ADMIN = 'admin',
}

export enum NotificationChannelStatus {
  SENT = 'sent',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

@Schema({ _id: false })
class ChannelOutcome {
  @Prop({ type: String, enum: NotificationChannelStatus, required: true })
  status: NotificationChannelStatus;

  @Prop()
  error?: string;
}

@Schema({ _id: false })
class ChannelOutcomes {
  @Prop({ type: ChannelOutcome })
  push?: ChannelOutcome;

  @Prop({ type: ChannelOutcome })
  email?: ChannelOutcome;
}

// One row per recipient's inbox entry, saved before sending; no ref on `recipient` since it points at User or Admin depending on `recipientType` (same polymorphic shape as AuditLog's entityType/entityId).
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
  @Prop({
    type: String,
    enum: NotificationRecipientType,
    required: true,
    index: true,
  })
  recipientType: NotificationRecipientType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  recipient: Types.ObjectId;

  // Event name, e.g. 'content_updated'/'report_resolved' — drives channel selection via notification-types.ts.
  @Prop({ required: true, index: true })
  type: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop({ type: Object })
  data?: Record<string, string>;

  @Prop({ type: ChannelOutcomes, default: () => ({}) })
  channels: ChannelOutcomes;

  // Set only when fanned out as part of a bulk NotificationBroadcast — absent for a single-recipient event.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'NotificationBroadcast' })
  broadcast?: Types.ObjectId;

  @Prop({ default: false, index: true })
  read: boolean;

  @Prop()
  readAt?: Date;

  createdAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ recipientType: 1, recipient: 1, createdAt: -1 });
