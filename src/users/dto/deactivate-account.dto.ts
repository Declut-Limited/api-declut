import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { USER_DEACTIVATION_REASONS } from '../schemas/user.schema';

export class DeactivateAccountDto {
  @IsIn(USER_DEACTIVATION_REASONS)
  reason: (typeof USER_DEACTIVATION_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
