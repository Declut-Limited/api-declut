import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { DevicePlatform } from '../schemas/device-token.schema';

export class RegisterDeviceTokenDto {
  @IsString()
  @MinLength(10)
  token: string;

  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform;
}
