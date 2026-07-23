import { IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  otpToken: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}
