import { IsString, Matches, MaxLength } from 'class-validator';

export class VerifyIdentityDto {
  @IsString()
  @Matches(/^\d{11}$/, { message: 'nin must be an 11-digit NIN' })
  nin: string;

  // Base64 selfie, matched against this NIN's record photo — never
  // persisted, only forwarded to the KYC provider.
  @IsString()
  @MaxLength(20_000_000)
  selfieImageBase64: string;
}
