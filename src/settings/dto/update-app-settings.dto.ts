import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

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
  @IsInt()
  @Min(1)
  offerExpiryDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  defaultSearchRadiusKm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCodeAttempts?: number;
}
