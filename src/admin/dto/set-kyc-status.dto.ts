import { IsEnum } from 'class-validator';
import { KycStatus } from '../../users/schemas/user.schema';

export class SetKycStatusDto {
  @IsEnum(KycStatus)
  status: KycStatus;
}
