import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  WaitlistInterest,
  WaitlistInviteStatus,
  WaitlistStatus,
} from '../schemas/waitlist.schema';

export class ListWaitlistDto {
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
  @IsEnum(WaitlistStatus)
  status?: WaitlistStatus;

  @IsOptional()
  @IsEnum(WaitlistInterest)
  interest?: WaitlistInterest;

  @IsOptional()
  @IsEnum(WaitlistInviteStatus)
  inviteStatus?: WaitlistInviteStatus;

  @IsOptional()
  @IsString()
  search?: string;
}
