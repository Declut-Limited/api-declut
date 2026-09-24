import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ParticipantDocument = HydratedDocument<Participant>;

export enum ParticipantStatus {
  IN_PROGRESS = 'in_progress',
  QUALIFIED = 'qualified',
  PAID = 'paid',
  DISQUALIFIED = 'disqualified',
  EXPIRED = 'expired',
  LEFT = 'left',
}

@Schema({ _id: false })
export class ParticipantProgress {
  @Prop({ default: 0 })
  amountOfReferrals: number;

  // Renamed casing only from the spec's "amountOfCOmpletedTransaction" —
  // typo fix, not a semantic change.
  @Prop({ default: 0 })
  amountOfCompletedTransaction: number;

  @Prop({ default: 0 })
  amountOfCompletedSales: number;
}
export const ParticipantProgressSchema =
  SchemaFactory.createForClass(ParticipantProgress);

@Schema({ timestamps: true })
export class Participant {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ReferralCampaign',
    required: true,
    index: true,
  })
  campaign: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  // Deterministic — built from part of the user's name, part of the
  // campaign's own code, and a fragment of the user's own id (e.g.
  // "DAMOLA-REFSEPT2026-A05F"), see ReferralsService.computeReferralCode().
  // A Participant record exists to make its owner a referrer for this
  // campaign — it has no concept of who referred *them*.
  @Prop({ required: true, unique: true })
  referralCode: string;

  @Prop({
    type: String,
    enum: ParticipantStatus,
    default: ParticipantStatus.IN_PROGRESS,
    index: true,
  })
  status: ParticipantStatus;

  // Set once, at the original first join — permanent, never touched again
  // (rejoining stamps rejoinedAt below instead, same "preserve the original
  // event, add a new field for what happens next" precedent as
  // Suspension.suspendedAt/unsuspendedAt).
  @Prop({ type: Date, required: true })
  joinedAt: Date;

  // Permanent — the last time they left, kept even after a rejoin
  // (explicit instruction: unlike Suspension/Deactivation's terminal
  // timestamp, this one is never cleared).
  @Prop({ type: Date })
  leftAt?: Date;

  // Only present once a participant has left and come back at least once —
  // stamped fresh on every rejoin, so it always reflects the most recent
  // one, not the first.
  @Prop({ type: Date })
  rejoinedAt?: Date;

  // Structure fixed at creation regardless of which tasks the campaign's
  // referralRequirement.eachReferredTask actually enables — all three
  // counters start at 0. Incrementing them based on real transaction/sale
  // events is explicitly deferred ("we'd add more to it later").
  @Prop({ type: ParticipantProgressSchema, default: () => ({}) })
  progress: ParticipantProgress;

  createdAt: Date;
  updatedAt: Date;
}

export const ParticipantSchema = SchemaFactory.createForClass(Participant);
// One participation per (campaign, user) — a rejoin reuses this same
// document (status flips back to in_progress) rather than creating a new
// row, so history/progress isn't lost across a leave→rejoin cycle.
ParticipantSchema.index({ campaign: 1, user: 1 }, { unique: true });
