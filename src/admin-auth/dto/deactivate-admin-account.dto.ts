import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ADMIN_DEACTIVATION_REASONS } from '../schemas/admin.schema';

export class DeactivateAdminAccountDto {
  @IsIn(ADMIN_DEACTIVATION_REASONS)
  reason: (typeof ADMIN_DEACTIVATION_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
