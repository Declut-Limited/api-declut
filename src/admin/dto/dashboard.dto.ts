import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const INSIGHTS_PERIODS = ['today', 'week', 'month', 'year', 'all'] as const;
export type DashboardInsightsPeriod = (typeof INSIGHTS_PERIODS)[number];

export class DashboardInsightsDto {
  @IsOptional()
  @IsIn(INSIGHTS_PERIODS)
  period?: DashboardInsightsPeriod;
}

// Always Jan-Dec of this calendar year — defaults to the current year.
export class RevenueTrendsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
