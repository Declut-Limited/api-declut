import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  // Nigerian mobile number — 07/08/09-prefixed local (11 digits) or +234
  // international form. Also the alternate login identifier alongside email.
  @IsString()
  @Matches(/^(?:\+234[789]\d{9}|0[789]\d{9})$/, {
    message:
      'phone must be a valid Nigerian phone number, e.g. 08012345678 or +2348012345678',
  })
  phone: string;

  // At least one letter and one number, 8-64 chars. Not a full complexity
  // policy — bcrypt cost 12 is doing the heavy lifting against brute force.
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password: string;
}
