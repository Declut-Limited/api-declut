import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ReferralDocument = HydratedDocument<Referral>;

// One document per person a participant has referred within a campaign.
// This is the mechanism that actually records "who referred whom" —
// Participant deliberately carries no such link (see its own schema
// comment). No create/update endpoints exist for this yet ("we'd add more
// soon") — this pass is the schema + the admin analytics reads over it.
@Schema({ timestamps: true })
export class Referral {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ReferralCampaign',
    required: true,
    index: true,
  })
  campaign: Types.ObjectId;

  // The referring Participant, not the raw User — "successful referrals"
  // is defined against the participant's own status (qualified/paid, see
  // ReferralsService.getAnalytics()), so the link has to be to Participant.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Participant',
    required: true,
    index: true,
  })
  referrer: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  referred: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  referredAt: Date;

  // Renamed from the spec's "qualifiedA" — typo for "qualifiedAt".
  @Prop({ type: Date, default: null })
  qualifiedAt: Date | null;

  @Prop({ default: false })
  hasCompletedChallenge: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);
