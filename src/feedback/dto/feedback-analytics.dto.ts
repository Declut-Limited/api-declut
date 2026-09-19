import { IsDateString, IsIn, IsOptional, ValidateIf } from 'class-validator';

// Same named-period shape as the admin dashboard's own filter
// (DashboardInsightsDto), plus lastYear — explicitly asked for here even
// though the dashboard's own filter doesn't have it.
const FEEDBACK_ANALYTICS_PERIODS = [
  'thisMonth',
  'lastMonth',
  'last3Months',
  'thisYear',
  'lastYear',
  'custom',
] as const;
export type FeedbackAnalyticsPeriod =
  (typeof FEEDBACK_ANALYTICS_PERIODS)[number];

export class FeedbackAnalyticsDto {
  @IsOptional()
  @IsIn(FEEDBACK_ANALYTICS_PERIODS)
  period?: FeedbackAnalyticsPeriod;

  // Required only when period=custom.
  @ValidateIf((o: FeedbackAnalyticsDto) => o.period === 'custom')
  @IsDateString()
  startDate?: string;

  @ValidateIf((o: FeedbackAnalyticsDto) => o.period === 'custom')
  @IsDateString()
  endDate?: string;
}
