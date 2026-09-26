import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ReferredTaskType } from './referral-campaign.schema';

export type ReferralDocument = HydratedDocument<Referral>;

// One entry per task TYPE the referred person has completed — added
// 2026-09-26, explicit instruction: a campaign's eachReferredTask can list
// BOTH complete_sale and complete_transaction, and when it does, the
// referred person must complete EACH one (not just one of them) before the
// referral counts. A single hasCompletedChallenge boolean can't represent
// "completed one of two required types," so this array tracks partial
// progress per type; hasCompletedChallenge/qualifiedAt/transaction below
// only flip once this array covers every type the campaign requires.
@Schema({ _id: false })
export class CompletedTask {
  @Prop({ type: String, enum: ReferredTaskType, required: true })
  taskType: ReferredTaskType;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
  })
  transaction: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  completedAt: Date;
}
export const CompletedTaskSchema = SchemaFactory.createForClass(CompletedTask);

// One document per person a participant has referred within a campaign.
// This is the mechanism that actually records "who referred whom" —
// Participant deliberately carries no such link (see its own schema
// comment). No create/update endpoints exist for this yet ("we'd add more
// soon") — this pass is the schema + the admin analytics reads over it.
@Schema({ timestamps: true })
export class Referral {
  // REF-#### — matches this app's per-entity slug convention and the
  // dashboard design's own displayed ids. No creation endpoint exists for
  // Referral yet, so nothing generates this today; added now so the field
  // is ready once one does.
  @Prop({ unique: true, sparse: true })
  slug?: string;

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

  // unique — a person can only ever be "the referred one" once, since this
  // is only ever created at their own signup (a one-time event). See
  // ReferralsService.recordSignupReferral().
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  referred: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  referredAt: Date;

  // Renamed from the spec's "qualifiedA" — typo for "qualifiedAt".
  @Prop({ type: Date, default: null })
  qualifiedAt: Date | null;

  @Prop({ default: false })
  hasCompletedChallenge: boolean;

  // The real Transaction that satisfied the LAST required task type for
  // this referral (the one that sealed hasCompletedChallenge) — evidence
  // the referred person actually did something on the marketplace, not
  // just signed up. Only set once the referral has fully qualified; the
  // full history of which task(s) completed when lives in completedTasks
  // below. Still absent for a still-in-progress referral.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Transaction' })
  transaction?: Types.ObjectId;

  @Prop({ type: [CompletedTaskSchema], default: [] })
  completedTasks: CompletedTask[];

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);
