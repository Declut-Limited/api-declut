import { IsString, MinLength } from 'class-validator';

export class RegisterDeviceTokenDto {
  @IsString()
  @MinLength(10)
  token: string;
}
