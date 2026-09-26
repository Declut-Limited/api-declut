import { IsOptional, IsString } from 'class-validator';

export class GoogleAuthDto {
  // Google-issued ID token from the mobile app's Google Sign-In flow —
  // verified server-side against Google's public keys, never trusted as-is.
  @IsString()
  idToken: string;

  // Optional referral code (Participant.referralCode) — only meaningful on
  // the genuinely-new-account branch of googleAuth(); ignored on an
  // existing user signing back in. An unknown/invalid code is silently
  // ignored, never blocks sign-in.
  @IsOptional()
  @IsString()
  referralCode?: string;
}
