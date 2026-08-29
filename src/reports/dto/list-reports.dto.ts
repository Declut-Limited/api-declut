import { IsEnum, IsOptional } from 'class-validator';
import { ReportStatus } from '../schemas/report.schema';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';

export class ListReportsDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}
