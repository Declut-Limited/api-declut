import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const INSIGHTS_FILTERS = [
  'thisMonth',
  'lastMonth',
  'last3Months',
  'thisYear',
  'custom',
] as const;
export type DashboardInsightsFilter = (typeof INSIGHTS_FILTERS)[number];

export class DashboardInsightsDto {
  @IsOptional()
  @IsIn(INSIGHTS_FILTERS)
  filter?: DashboardInsightsFilter;

  // Required only when filter=custom.
  @ValidateIf((o: DashboardInsightsDto) => o.filter === 'custom')
  @IsDateString()
  startDate?: string;

  @ValidateIf((o: DashboardInsightsDto) => o.filter === 'custom')
  @IsDateString()
  endDate?: string;
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
