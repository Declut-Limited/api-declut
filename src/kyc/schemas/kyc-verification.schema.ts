import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type KycVerificationDocument = HydratedDocument<KycVerification>;

export enum KycVerificationStatus {
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

/**
 * Audit trail of verification attempts — deliberately holds only the
 * provider's result (pass/fail + reference id), never the selfie/ID photo
 * bytes themselves, per CLAUDE.md's KYC image handling rule.
 */
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
