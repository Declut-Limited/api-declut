import { IsEmail } from 'class-validator';

export class AdminForgotPasswordDto {
  @IsEmail()
  email: string;
}
