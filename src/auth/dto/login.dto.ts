import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Either an email or a Nigerian phone number — AuthService disambiguates
  // by checking for '@'. Not narrowed with @IsEmail()/@Matches() here since
  // it has to accept both shapes; findByIdentifierWithPassword() is what
  // actually looks the account up, and a wrong-shape value just fails to
  // match anything and falls into the same generic "invalid credentials".
  @IsString()
  @MinLength(3)
  identifier: string;

  @IsString()
  password: string;
}
