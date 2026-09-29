import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RewardDocument = HydratedDocument<Reward>;

export enum RewardStatus {
  PENDING = 'pending',
  PAID = 'paid',
  CANCELED = 'canceled',
}

// One document per reward owed to a participant for a specific referred
// person. No create/update endpoints exist for this yet ("we'd add more
// soon") — this pass is the schema + the admin analytics reads over it.
@Schema({ timestamps: true })
export class Reward {
  // RWD-#### — same "added now, generated once a create flow exists" note
  // as Referral.slug above.
  @Prop({ unique: true, sparse: true })
  slug?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ReferralCampaign',
    required: true,
    index: true,
  })
  campaign: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Participant',
    required: true,
    index: true,
  })
  participant: Types.ObjectId;

  // Added 2026-09-27 — the specific Referral this reward was created for.
  // One Reward per Referral now (reworked, explicit instruction), so this
  // replaces the old (campaign, participant, referred) triple-match used to
  // resolve qualifiedOn. Optional/sparse-in-practice — Reward rows created
  // before this field existed have none, no backfill (same "old data
  // predates a new invariant" precedent every other schema addition in this
  // app follows).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Referral', index: true })
  referral?: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  referred: Types.ObjectId;

  @Prop({
    type: String,
    enum: RewardStatus,
    default: RewardStatus.PENDING,
    index: true,
  })
  status: RewardStatus;

  // How much has actually been paid out on this reward — 0 while pending,
  // set to the real disbursed amount once status flips to paid.
  @Prop({ type: Number, default: 0, min: 0 })
  amountPaid: number;

  createdAt: Date;
  updatedAt: Date;
}

export const RewardSchema = SchemaFactory.createForClass(Reward);
