import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WaitlistDocument = HydratedDocument<Waitlist>;

export enum WaitlistInterest {
  BUYING = 'buying',
  SELLING = 'selling',
  BOTH = 'both',
}

// invited is set together with inviteStatus=sent, at the moment an invite
// email goes out. joined is set once the invited email actually signs up
// as a real User — not built yet, part of the deferred invite flow.
export enum WaitlistStatus {
  WAITING = 'waiting',
  INVITED = 'invited',
  JOINED = 'joined',
}

export enum WaitlistInviteStatus {
  NOT_SENT = 'not_sent',
  SENT = 'sent',
  DELIVERED = 'delivered',
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Waitlist {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ type: String, enum: WaitlistInterest, required: true })
  interest: WaitlistInterest;

  @Prop({ type: String, enum: WaitlistStatus, default: WaitlistStatus.WAITING })
  status: WaitlistStatus;

  @Prop({
    type: String,
    enum: WaitlistInviteStatus,
    default: WaitlistInviteStatus.NOT_SENT,
  })
  inviteStatus: WaitlistInviteStatus;

  createdAt: Date;
}

export const WaitlistSchema = SchemaFactory.createForClass(Waitlist);
