import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DevicePlatform } from '../schemas/device-token.schema';

class DeviceTokenEntryDto {
  @IsString()
  @MinLength(10)
  token: string;

  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform;
}

export class RegisterDeviceTokenDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DeviceTokenEntryDto)
  tokens: DeviceTokenEntryDto[];
}
