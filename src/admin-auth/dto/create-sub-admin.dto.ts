import {
  IsEmail,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// password/title/company removed 2026-09-18, explicit instruction — a
// secure password is now generated server-side (see
// generateSecurePassword() in AdminAuthService), and title/company aren't
// collected at creation at all anymore (still exist on the Admin schema,
// just with no write path here — see the general-profile endpoint and the
// seed script for the other ways they can get set).
export class CreateSubAdminDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  // Every admin must be assigned a Role at creation — this is what actually determines its access. See src/roles/.
  @IsMongoId()
  roleId: string;
}
