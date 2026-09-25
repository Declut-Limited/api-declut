import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';
import { ParticipantStatus } from '../schemas/participant.schema';

export class ListReferralParticipantsDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsEnum(ParticipantStatus)
  status?: ParticipantStatus;

  @IsOptional()
  @IsMongoId()
  campaignId?: string;

  // Case-insensitive substring match against the participant's own name or
  // their campaign's name.
  @IsOptional()
  @IsString()
  search?: string;
}
