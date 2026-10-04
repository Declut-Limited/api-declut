import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateKycSettingsDto {
  @IsOptional()
  @IsBoolean()
  useKycProvider?: boolean;

  @IsOptional()
  @IsString()
  kycProvider?: string;
}
