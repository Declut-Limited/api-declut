import { IsString } from 'class-validator';

export class AdminResendOtpDto {
  @IsString()
  otpToken: string;
}
