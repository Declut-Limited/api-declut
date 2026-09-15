import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type NotificationSettingDocument = HydratedDocument<NotificationSetting>;

// Both independently toggleable — true/true, false/false, or either mix, no forced correlation.
@Schema({ _id: false })
class NotificationChannels {
  @Prop({ default: false })
  push: boolean;

  @Prop({ default: false })
  email: boolean;
}

// One per user. Purely a preferences store for now — no send path reads these yet, see CLAUDE.md's Notification Settings section.
@Schema({ timestamps: true })
export class NotificationSetting {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  user: Types.ObjectId;

  @Prop({ type: NotificationChannels, default: () => ({}) })
  channels: NotificationChannels;

  // User-toggleable — default false (opt-in).
  @Prop({ default: false })
  transactionUpdates: boolean;

  @Prop({ default: true })
  inspectionReminders: boolean;

  @Prop({ default: false })
  disputeUpdates: boolean;

  // Required, not user-toggleable — always true, excluded from
  // UpdateNotificationSettingDto entirely (forbidNonWhitelisted 400s a
  // client that tries to send one) and marked immutable at the schema
  // level as a second line of defense against any other write path.
  @Prop({ default: true, immutable: true })
  paymentAndEscrowUpdates: boolean;

  @Prop({ default: true, immutable: true })
  listingActivity: boolean;

  @Prop({ default: true, immutable: true })
  productUpdates: boolean;

  @Prop({ default: true, immutable: true })
  referralAndRewards: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const NotificationSettingSchema =
  SchemaFactory.createForClass(NotificationSetting);
