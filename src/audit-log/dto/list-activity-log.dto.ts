import { IsEnum, IsOptional } from 'class-validator';
import { AuditEntityType } from '../schemas/audit-log.schema';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';

export class ListActivityLogDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsEnum(AuditEntityType)
  entityType?: AuditEntityType;
}
