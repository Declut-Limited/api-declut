import { IsDateString, IsIn, IsOptional, ValidateIf } from 'class-validator';

// Same named-period shape as the Feedback module's own analytics endpoint,
// mirrored per explicit instruction ("filtered by period startDate and
// endDate just like we have in the feedback analysis").
const REFERRAL_ANALYTICS_PERIODS = [
  'thisMonth',
  'lastMonth',
  'last3Months',
  'thisYear',
  'lastYear',
  'custom',
] as const;
export type ReferralAnalyticsPeriod =
  (typeof REFERRAL_ANALYTICS_PERIODS)[number];

export class ReferralAnalyticsDto {
  @IsOptional()
  @IsIn(REFERRAL_ANALYTICS_PERIODS)
  period?: ReferralAnalyticsPeriod;

  // Required only when period=custom.
  @ValidateIf((o: ReferralAnalyticsDto) => o.period === 'custom')
  @IsDateString()
  startDate?: string;

  @ValidateIf((o: ReferralAnalyticsDto) => o.period === 'custom')
  @IsDateString()
  endDate?: string;
}
