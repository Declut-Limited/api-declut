import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// One shared year filter for every section of the dashboard — mirrors
// RevenueTrendsDto's own shape. Defaults to the current calendar year.
export class ReferralDashboardDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
