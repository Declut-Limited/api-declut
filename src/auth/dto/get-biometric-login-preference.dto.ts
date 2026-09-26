import { IsEmail } from 'class-validator';

export class GetBiometricLoginPreferenceDto {
  @IsEmail()
  email: string;
}
