import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';
import { RewardStatus } from '../schemas/reward.schema';

export class ListReferralRewardsDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsEnum(RewardStatus)
  status?: RewardStatus;

  @IsOptional()
  @IsMongoId()
  campaignId?: string;

  // Case-insensitive substring match against the participant's own name or
  // their campaign's name.
  @IsOptional()
  @IsString()
  search?: string;
}
