import { IsEnum, IsOptional } from 'class-validator';
import { ContentStatus, ContentType } from '../schemas/content.schema';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';

export class ListContentDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;
}
