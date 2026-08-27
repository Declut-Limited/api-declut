import {
  IsBoolean,
  IsEmail,
  IsISO4217CurrencyCode,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsTimeZone,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Backs the original unscoped PATCH /admin/settings — a full update over
// the whole AppSettings singleton, kept in sync with every field the
// category-scoped endpoints (general/payments/fees) also cover.
export class UpdateAppSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  escrowStalledThresholdDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPercentage?: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  companyName?: string;

  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @IsOptional()
  @IsISO4217CurrencyCode()
  defaultCurrency?: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  cardPaymentsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  bankTransferEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  buyerServiceFeePercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  escrowReleaseFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumPayoutThreshold?: number;
}
