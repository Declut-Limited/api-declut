import { IsEnum } from 'class-validator';
import { ReportStatus } from '../schemas/report.schema';

export class UpdateReportStatusDto {
  @IsEnum(ReportStatus)
  status: ReportStatus;
}
