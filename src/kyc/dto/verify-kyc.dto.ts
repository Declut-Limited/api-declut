import { IsString, Matches, MaxLength } from 'class-validator';

export class VerifyKycDto {
  @IsString()
  @Matches(/^\d{11}$/, { message: 'nin must be an 11-digit NIN' })
  nin: string;

  // Base64-encoded selfie image. Never written to disk/DB/Cloudinary — held
  // in memory just long enough to forward to the KYC provider. ~15MB decoded
  // ceiling (base64 is ~1.37x larger than raw bytes).
  @IsString()
  @MaxLength(20_000_000)
  selfieImageBase64: string;
}
