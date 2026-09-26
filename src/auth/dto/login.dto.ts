import { IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(3)
  identifier: string;

  @IsString()
  password: string;

  // Push token — overwrites User.deviceToken if present, same as POST /notifications/register-token.
  @IsOptional()
  @IsString()
  @MinLength(10)
  pushToken?: string;
}
