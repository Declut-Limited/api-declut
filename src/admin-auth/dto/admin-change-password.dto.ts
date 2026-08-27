import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AdminChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'newPassword must contain at least one letter and one number',
  })
  newPassword: string;

  // Equality against newPassword is checked in AdminAuthService.changePassword()
  // rather than a cross-field decorator — matches this codebase's existing
  // convention of business-rule checks living in the service, not the DTO.
  @IsString()
  confirmNewPassword: string;
}
