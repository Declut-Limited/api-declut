import { IsEnum, IsOptional } from 'class-validator';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';
import { ReferralCampaignStatus } from '../schemas/referral-campaign.schema';

export class ListReferralCampaignsDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsEnum(ReferralCampaignStatus)
  status?: ReferralCampaignStatus;
}
