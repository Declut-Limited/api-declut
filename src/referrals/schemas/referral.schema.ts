import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ReferredTaskType } from './referral-campaign.schema';

export type ReferralDocument = HydratedDocument<Referral>;

// Added 2026-09-27, explicit instruction: qualification/reward-eligibility
// now lives on the Referral, not the Participant. A referral is in_progress
// until its referred person hits referralRequirement.referralAmount
// qualifying completions; completed is the one moment a Reward is created
// for it; disqualified only ever happens via the campaign-expiry sweep
// (ReferralsService.sweepExpiredCampaigns()) — an in-progress referral whose
// campaign ended before it finished.
export enum ReferralStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  DISQUALIFIED = 'disqualified',
}

// One entry per qualifying task completion the referred person has racked
// up — reworked 2026-09-27, explicit instruction: no longer deduped by task
// type (the 2026-09-26 "each type once" rule). referralRequirement.
// referralAmount is now a COUNT of qualifying completions (of any type
// listed in eachReferredTask) this one referred person must reach before
// the referral counts — completedTasks.length is what's compared against
// it. hasCompletedChallenge/status/qualifiedAt/transaction below only flip
// once that count is hit.
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

  // The referring Participant, not the raw User — a Referral belongs to one
  // person's participation in one campaign.
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

  // Kept alongside hasCompletedChallenge (which stays as-is for response-
  // shape stability) — this is the richer signal, since a boolean alone
  // can't distinguish "still in progress" from "disqualified."
  @Prop({
    type: String,
    enum: ReferralStatus,
    default: ReferralStatus.IN_PROGRESS,
    index: true,
  })
  status: ReferralStatus;

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
