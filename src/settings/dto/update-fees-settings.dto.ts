import {
  IsISO4217CurrencyCode,
  IsNumber,
  IsOptional,
  IsTimeZone,
  Max,
  Min,
} from 'class-validator';

export class UpdateFeesSettingsDto {
  // "Default Commission Rate (%)" in the admin UI — reuses the existing
  // commissionPercentage property rather than a new field.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPercentage?: number;

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

  // Repeated on this tab in the admin UI — reuses the existing
  // defaultCurrency/timezone properties, not new fields.
  @IsOptional()
  @IsISO4217CurrencyCode()
  defaultCurrency?: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}
