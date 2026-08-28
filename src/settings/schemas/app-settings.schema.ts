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

  createdAt: Date;
  updatedAt: Date;
}

export const AppSettingsSchema = SchemaFactory.createForClass(AppSettings);
