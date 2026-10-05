import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type KycVerificationDocument = HydratedDocument<KycVerification>;

export enum KycVerificationStatus {
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  // No automated decision was made — manual-review mode
  // (AppSettings.useKycProvider: false). Awaits an admin override.
  PENDING = 'pending',
}

export enum KycCheckStage {
  // NIN + selfie verified together in one provider call — the only stage
  // new attempts are recorded under.
  IDENTITY = 'identity',
  // Legacy: the old two-step flow (separate NIN then selfie checks). Kept
  // so existing history rows still validate.
  NIN = 'nin',
  LIVENESS = 'liveness',
}

// Audit trail only — pass/fail + reference id per attempt, never the
// selfie/ID photo bytes themselves.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class KycVerification {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({ required: true, default: 'qoreid' })
  provider: string;

  @Prop({ type: String, enum: KycCheckStage, required: true })
  stage: KycCheckStage;

  @Prop({ type: String, enum: KycVerificationStatus, required: true })
  status: KycVerificationStatus;

  @Prop({ required: true })
  referenceId: string;

  @Prop()
  failureReason?: string;

  createdAt: Date;
}

export const KycVerificationSchema =
  SchemaFactory.createForClass(KycVerification);
