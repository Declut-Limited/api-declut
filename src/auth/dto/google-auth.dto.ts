import { IsString } from 'class-validator';

export class GoogleAuthDto {
  // Google-issued ID token from the mobile app's Google Sign-In flow —
  // verified server-side against Google's public keys, never trusted as-is.
  @IsString()
  idToken: string;
}
