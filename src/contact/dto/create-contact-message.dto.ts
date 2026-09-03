import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateContactMessageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  // Nigerian mobile number — same format RegisterDto.phone already uses.
  @IsString()
  @Matches(/^(?:\+234[789]\d{9}|0[789]\d{9})$/, {
    message:
      'phone must be a valid Nigerian phone number, e.g. 08012345678 or +2348012345678',
  })
  phone: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message: string;
}
