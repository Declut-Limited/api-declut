import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  message?: string;
}
