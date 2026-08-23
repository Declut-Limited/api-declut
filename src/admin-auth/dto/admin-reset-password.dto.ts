import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// token now travels as a URL param (POST /admin/auth/reset-password/:token),
// not a body field — matches the emailed reset link's own shape.
export class AdminResetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password: string;

  @IsString()
  passwordConfirm: string;
}
