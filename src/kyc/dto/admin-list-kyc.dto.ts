import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';
import { KycStatus } from '../../users/schemas/user.schema';

export class AdminListKycDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsEnum(KycStatus)
  status?: KycStatus;

  // Case-insensitive substring match against the user's own name or email.
  @IsOptional()
  @IsString()
  search?: string;
}
