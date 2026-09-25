import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

// One shared year filter for every section of the dashboard — mirrors
// RevenueTrendsDto's own shape. Defaults to the current calendar year.
// rewardSpent is always locked to one specific year regardless of allTime
// (a 12-month Jan-Dec chart has no sensible "all time" reading) — allTime
// only widens campaignPerformance/topReferrals/qualificationStatus to every
// document ever, ignoring year entirely.
export class ReferralDashboardDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allTime?: boolean;
}
