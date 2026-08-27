import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateAdminGeneralProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName?: string;

  // Same Nigerian-format pattern RegisterDto uses for User.phone —
  // class-validator's IsPhoneNumber() needs libphonenumber-js, not installed.
  @IsOptional()
  @Matches(/^(?:\+234[789]\d{9}|0[789]\d{9})$/, {
    message:
      'phone must be a valid Nigerian phone number, e.g. 08012345678 or +2348012345678',
  })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
