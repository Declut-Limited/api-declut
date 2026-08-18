import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type CampaignDocument = HydratedDocument<Campaign>;

export enum CampaignChannel {
  PUSH = 'push',
  EMAIL = 'email',
}

export enum CampaignStatus {
  DRAFT = 'draft',
  SENT = 'sent',
}

@Schema({ timestamps: true })
export class Campaign {
  // Doubles as the push notification title / email subject — kept as one
  // field rather than a separate subject, same "don't add fields beyond
  // what's needed" reasoning as Report's title+reason pair.
  @Prop({ required: true, trim: true, maxlength: 160 })
  title: string;

  @Prop({ required: true, maxlength: 5000 })
  message: string;

  @Prop({ type: String, enum: CampaignChannel, required: true })
  channel: CampaignChannel;

  @Prop({ type: String, enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: Types.ObjectId;

  @Prop()
  sentAt?: Date;

  // Set once, at send time — how many users the campaign actually went out
  // to, for display after the fact.
  @Prop()
  recipientCount?: number;

  createdAt: Date;
  updatedAt: Date;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
