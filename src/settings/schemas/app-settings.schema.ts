import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppSettingsDocument = HydratedDocument<AppSettings>;

@Schema({ _id: false })
export class InspectionWindow {
  @Prop({ required: true, min: 1, default: 5 })
  inspectionPeriod: number;

  @Prop({ required: true, default: false })
  allowExtension: boolean;

  @Prop({ required: true, min: 1, default: 5 })
  maxExtensionPeriod: number;
}

@Schema({ timestamps: true })
export class AppSettings {
  @Prop({ type: InspectionWindow, required: true, default: () => ({}) })
  inspectionWindow: InspectionWindow;

  @Prop({ required: true, min: 0, max: 100, default: 10 })
  commissionPercentage: number;

  @Prop({ required: true, min: 1, default: 3 })
  maxCodeAttempts: number;

  // General/brand settings — first of 4 category-scoped update endpoints
  // (PATCH /admin/settings/general), added 2026-08-27. Still on the same
  // singleton document; only the update side is being split by category.
  @Prop({ required: true, trim: true, default: 'Declut Marketplace' })
  companyName: string;

  @Prop({
    required: true,
    trim: true,
    lowercase: true,
    default: 'support@declut.com',
  })
  supportEmail: string;

  @Prop({ required: true, uppercase: true, default: 'NGN' })
  defaultCurrency: string;

  @Prop({ required: true, default: 'Africa/Lagos' })
  timezone: string;

  @Prop({ required: true, default: false })
  cardPaymentsEnabled: boolean;

  @Prop({ required: true, default: false })
  bankTransferEnabled: boolean;

  @Prop({ required: true, min: 0, max: 100, default: 0 })
  buyerServiceFeePercentage: number;

  @Prop({ required: true, min: 0, default: 0 })
  escrowReleaseFee: number;

  @Prop({ required: true, min: 0, default: 0 })
  minimumPayoutThreshold: number;

  // Issue Resolution SLA settings — added 2026-09-18, explicit instruction
  // (PATCH /admin/settings/issue-resolution-sla). enableSellerSLA is the
  // master switch: when false, the other four fields are stored but
  // meaningless — nothing currently reads any of these five yet (business
  // logic wiring wasn't asked for this pass, matching the same
  // "settings endpoint built, behavior not yet wired" posture the payment
  // toggles above already had).
  @Prop({ required: true, default: true })
  enableSellerSLA: boolean;

  @Prop({ required: true, min: 1, default: 24 })
  sellerResponseSlaTimeInHour: number;

  @Prop({ required: true, default: true })
  autoEscalateSlaOnExpiry: boolean;

  // Default true — not explicitly specified, judgment call matching the
  // other two boolean fields in this same group. Flagged.
  @Prop({ required: true, default: true })
  sendSlaReminderBeforeDeadline: boolean;

  @Prop({ required: true, min: 1, default: 6 })
  reminderSlaTimeInHour: number;

  createdAt: Date;
  updatedAt: Date;
}

export const AppSettingsSchema = SchemaFactory.createForClass(AppSettings);
