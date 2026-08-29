import { IsEnum, IsOptional } from 'class-validator';
import { NotificationBroadcastStatus } from '../schemas/notification-broadcast.schema';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';

export class ListNotificationBroadcastsDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsEnum(NotificationBroadcastStatus)
  status?: NotificationBroadcastStatus;
}
