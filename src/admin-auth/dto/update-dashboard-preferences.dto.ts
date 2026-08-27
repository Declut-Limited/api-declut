import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsTimeZone,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
const TIME_FORMATS = ['12-Hour', '24-Hour'] as const;

export class UpdateDashboardPreferencesDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  landingPage?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  rowsPerPage?: number;

  @IsOptional()
  @IsIn(DATE_FORMATS)
  dateFormat?: string;

  @IsOptional()
  @IsIn(TIME_FORMATS)
  timeFormat?: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;
}
