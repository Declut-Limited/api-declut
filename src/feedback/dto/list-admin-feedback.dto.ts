import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';
import { FeedbackStatus, FeedbackType } from '../schemas/feedback.schema';

export class ListAdminFeedbackDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @IsOptional()
  @IsEnum(FeedbackType)
  type?: FeedbackType;
}
