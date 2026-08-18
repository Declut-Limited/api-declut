import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { CampaignChannel } from '../schemas/campaign.schema';

export class CreateCampaignDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  message: string;

  @IsEnum(CampaignChannel)
  channel: CampaignChannel;
}
