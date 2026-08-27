import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationBroadcastStatus } from '../schemas/notification-broadcast.schema';

export class ListNotificationBroadcastsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(NotificationBroadcastStatus)
  status?: NotificationBroadcastStatus;
}
