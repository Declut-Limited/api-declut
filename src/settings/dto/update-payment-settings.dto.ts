import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

// Sent as a whole object when present — not individually mergeable like
// dashboardPreferences, so no partial-nested-update logic is needed in
// SettingsService (its generic $set: dto path just overwrites the sub-document).
class InspectionWindowDto {
  @IsInt()
  @Min(1)
  inspectionPeriod: number;

  @IsBoolean()
  allowExtension: boolean;

  @IsInt()
  @Min(1)
  maxExtensionPeriod: number;
}

export class UpdatePaymentSettingsDto {
  @IsOptional()
  @IsBoolean()
  cardPaymentsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  bankTransferEnabled?: boolean;

  // Replaces escrowStalledThresholdDays (2026-08-28, explicit instruction).
  @IsOptional()
  @ValidateNested()
  @Type(() => InspectionWindowDto)
  inspectionWindow?: InspectionWindowDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCodeAttempts?: number;
}
