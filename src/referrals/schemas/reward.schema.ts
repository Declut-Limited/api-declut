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
