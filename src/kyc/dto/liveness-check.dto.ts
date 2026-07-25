import { IsString, MaxLength } from 'class-validator';

export class LivenessCheckDto {
  // Base64 selfie — never persisted, only forwarded to the KYC provider.
  @IsString()
  @MaxLength(20_000_000)
  selfieImageBase64: string;
}
