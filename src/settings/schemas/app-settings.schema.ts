import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppSettingsDocument = HydratedDocument<AppSettings>;

@Schema({ timestamps: true })
export class AppSettings {
  @Prop({ required: true, min: 1, default: 5 })
  escrowStalledThresholdDays: number;

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

  // Payments settings — endpoint 2 of the 4 category-scoped update
  // endpoints (PATCH /admin/settings/payments), added 2026-08-27. The two
  // toggles are admin-facing config only for now — nothing in checkout
  // branches on them yet (Paystack is still the only wired payment path).
  // escrowStalledThresholdDays above is reused as-is for "Escrow release
  // window" rather than adding a second day-count field for the same concept.
  @Prop({ required: true, default: false })
  cardPaymentsEnabled: boolean;

  @Prop({ required: true, default: false })
  bankTransferEnabled: boolean;

  // Fees & commission settings — endpoint 3 of the 4 category-scoped update
  // endpoints (PATCH /admin/settings/fees), added 2026-08-27.
  // commissionPercentage above is reused as-is for "Default Commission
  // Rate"; defaultCurrency/timezone above are reused as-is too (the admin
  // UI repeats them on this tab). Not yet wired into checkout/payout
  // logic — same "admin-facing config only for now" posture as the
  // payments toggles above.
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
