import { IsOptional, IsString, MinLength } from 'class-validator';
import { RefreshTokenDto } from './refresh-token.dto';

export class LoginWithBiometricDto extends RefreshTokenDto {
  // Push token — overwrites User.deviceToken if present, same as
  // register/login. Kept off the plain RefreshTokenDto so /auth/refresh's
  // own contract isn't affected — a biometric login is a real login event,
  // a token refresh isn't.
  @IsOptional()
  @IsString()
  @MinLength(10)
  pushToken?: string;
}
