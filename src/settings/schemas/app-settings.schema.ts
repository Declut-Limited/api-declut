import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppSettingsDocument = HydratedDocument<AppSettings>;

/**
 * Singleton — exactly one document ever exists (no field to key it by;
 * SettingsService always queries/upserts with an empty filter). These five
 * fields used to be env vars, fixed at deploy time; moved to the DB
 * (2026-07-23) so admins can tune them at runtime via GET/PATCH
 * /admin/settings. Defaults below match what the env vars used to default
 * to, so behavior is unchanged until an admin actually edits one.
 */
@Schema({ timestamps: true })
export class AppSettings {
  @Prop({ required: true, min: 1, default: 5 })
  escrowStalledThresholdDays: number;

  @Prop({ required: true, min: 0, max: 100, default: 10 })
  commissionPercentage: number;

  @Prop({ required: true, min: 1, default: 3 })
  offerExpiryDays: number;

  @Prop({ required: true, min: 0.1, default: 15 })
  defaultSearchRadiusKm: number;

  @Prop({ required: true, min: 1, default: 3 })
  maxCodeAttempts: number;

  createdAt: Date;
  updatedAt: Date;
}

export const AppSettingsSchema = SchemaFactory.createForClass(AppSettings);
