import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ReferralCampaignDocument = HydratedDocument<ReferralCampaign>;

export enum ReferralCampaignStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  SCHEDULED = 'scheduled',
  ENDED = 'ended',
}

// Only one value for now, per the spec — a real enum (not a hardcoded
// constant) so a future reward type is just a new member, no DTO/schema
// shape change.
export enum ReferralRewardType {
  FIXED_CASH = 'fixed_cash',
}

export enum ReferredTaskType {
  COMPLETE_SALE = 'complete_sale',
  COMPLETE_TRANSACTION = 'complete_transaction',
}

export enum EligibleUsers {
  ALL_REGISTERED_USERS = 'all_registered_users',
  NEW_USERS_ONLY = 'new_users_only',
  EXISTING_USERS = 'existing_users',
}

export enum EligibleLocation {
  ALL_SUPPORTED_LOCATIONS = 'all_supported_locations',
  LAGOS = 'lagos',
  ABUJA = 'abuja',
  PORT_HARCOURT = 'port_harcourt',
}

export enum ReferralPaymentMethod {
  BANK_TRANSFER = 'bank_transfer',
}

export enum ReferralPaymentSchedule {
  IMMEDIATELY_AFTER_APPROVAL = 'immediately_after_approval',
  DAILY_BATCH = 'daily_batch',
  WEEKLY_BATCH = 'weekly_batch',
  MANUAL_BATCH = 'manual_batch',
}

@Schema({ _id: false })
export class ReferralRequirement {
  // Number of qualifying referrals a referrer must make — judgment call on
  // naming/meaning, flagged: the spec named this field with no further
  // description; read as a referral-count threshold since it sits beside
  // eachReferredTask/the two minimum-value fields, which all describe what
  // "counts" as a qualifying referral.
  @Prop({ required: true, min: 1 })
  referralAmount: number;

  @Prop({ type: [String], enum: ReferredTaskType, required: true })
  eachReferredTask: ReferredTaskType[];

  @Prop({ required: true, min: 0 })
  minimumTransactionValueCompletedSale: number;

  // Renamed from the spec's "minimumTransactionValueCompletedTransacion" —
  // corrected typo ("Transacion" -> "Transaction").
  @Prop({ required: true, min: 0 })
  minimumTransactionValueCompletedTransaction: number;
}
export const ReferralRequirementSchema =
  SchemaFactory.createForClass(ReferralRequirement);

@Schema({ _id: false })
export class ReferralEligibility {
  @Prop({ type: String, enum: EligibleUsers, required: true })
  eligibleUsers: EligibleUsers;

  @Prop({ type: String, enum: EligibleLocation, required: true })
  eligibleLocation: EligibleLocation;
}
export const ReferralEligibilitySchema =
  SchemaFactory.createForClass(ReferralEligibility);

@Schema({ _id: false })
export class ReferralValidationRules {
  @Prop({ default: false })
  transactionCompleted: boolean;

  // Renamed from the spec's "escrowRealsed" (typo for "escrowReleased").
  @Prop({ default: false })
  escrowReleased: boolean;

  @Prop({ default: false })
  notRefunded: boolean;

  @Prop({ default: false })
  notDisputed: boolean;

  @Prop({ default: false })
  notFlagged: boolean;

  @Prop({ default: false })
  meetsMinimumTransactionAmount: boolean;
}
export const ReferralValidationRulesSchema = SchemaFactory.createForClass(
  ReferralValidationRules,
);

@Schema({ timestamps: true })
export class ReferralCampaign {
  @Prop({ required: true, trim: true, maxlength: 150 })
  name: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  description: string;

  // Admin-supplied, not auto-generated via CounterService like every other
  // slug in this app — explicit instruction. Unique, case-sensitive as typed
  // (no uppercase/trim-case transform applied, since none was asked for).
  @Prop({ required: true, unique: true, trim: true })
  internalCampaignCode: string;

  @Prop({
    type: String,
    enum: ReferralCampaignStatus,
    default: ReferralCampaignStatus.DRAFT,
    index: true,
  })
  status: ReferralCampaignStatus;

  // Optional — "we can start from now" per the spec.
  @Prop({ type: Date })
  startDate?: Date;

  @Prop({ type: Date, required: true })
  endDate: Date;

  @Prop({ type: String, enum: ReferralRewardType, required: true })
  rewardType: ReferralRewardType;

  @Prop({ required: true, min: 0 })
  rewardAmount: number;

  @Prop({ required: true, min: 0 })
  maxCampaignBudget: number;

  @Prop({ type: ReferralRequirementSchema, required: true })
  referralRequirement: ReferralRequirement;

  // In days.
  @Prop({ required: false, min: 1 })
  qualificationWindow: number;

  @Prop({ type: ReferralEligibilitySchema, required: true })
  eligibility: ReferralEligibility;

  @Prop({ type: ReferralValidationRulesSchema, required: true })
  validationRules: ReferralValidationRules;

  @Prop({ type: String, enum: ReferralPaymentMethod, required: true })
  paymentMethod: ReferralPaymentMethod;

  @Prop({ type: String, enum: ReferralPaymentSchedule, required: true })
  paymentSchedule: ReferralPaymentSchedule;

  // Only meaningful when status is SCHEDULED — required together in that
  // case (enforced in the DTO). The cron sweep that actually reads these to
  // auto-publish a scheduled campaign isn't built in this pass — only the
  // 4 endpoints asked for (create/update/get/list) are; flag when that
  // sweep is wanted.
  @Prop({ type: Date })
  activationDate?: Date;

  // A plain time-of-day string (e.g. "14:30"), not a Date — kept as its own
  // field exactly as specified, combined with activationDate by whatever
  // eventually reads it.
  @Prop({ trim: true })
  activationTime?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: Types.ObjectId;

  // Array, not a single most-recent updater — explicit spec ("updatedBy
  // [array of admin ids]"), a running history of every admin who has ever
  // edited this campaign, appended to (never overwritten) on each update.
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'Admin', default: [] })
  updatedBy: Types.ObjectId[];

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralCampaignSchema =
  SchemaFactory.createForClass(ReferralCampaign);
