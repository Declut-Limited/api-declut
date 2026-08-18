import { IsIn, IsOptional } from 'class-validator';

const INSIGHTS_PERIODS = ['today', 'week', 'month', 'year', 'all'] as const;
export type DashboardInsightsPeriod = (typeof INSIGHTS_PERIODS)[number];

export class DashboardInsightsDto {
  @IsOptional()
  @IsIn(INSIGHTS_PERIODS)
  period?: DashboardInsightsPeriod;
}

const REVENUE_TREND_PERIODS = ['yearly', 'quarterly'] as const;
export type RevenueTrendPeriod = (typeof REVENUE_TREND_PERIODS)[number];

export class RevenueTrendsDto {
  @IsOptional()
  @IsIn(REVENUE_TREND_PERIODS)
  period?: RevenueTrendPeriod;
}
