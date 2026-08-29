import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  WaitlistInterest,
  WaitlistInviteStatus,
  WaitlistStatus,
} from '../schemas/waitlist.schema';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';

export class ListWaitlistDto extends PaginatedDateRangeDto {
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
