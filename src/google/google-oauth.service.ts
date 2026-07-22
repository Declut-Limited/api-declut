import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity {
  googleId: string;
  email: string;
  name: string;
}

/**
 * Verifies a Google-issued ID token directly against Google's own public
 * keys — no Firebase involved. The mobile app gets this token straight from
 * Google Sign-In; we never trust a client-supplied id/email, only what
 * Google's library confirms after checking the token's signature, issuer,
 * expiry, and audience (our registered OAuth client id).
 */
@Injectable()
export class GoogleOAuthService {
  private client: OAuth2Client | null = null;

  constructor(private readonly config: ConfigService) {}

  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    const audience = this.audience();
    if (audience.length === 0) {
      throw new InternalServerErrorException(
        'Google sign-in is not configured on this server yet',
      );
    }

    if (!this.client) {
      this.client = new OAuth2Client();
    }

    const ticket = await this.client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email) {
      throw new Error('Google token missing required claims');
    }

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email.split('@')[0],
    };
  }

  private audience(): string[] {
    return (this.config.get<string>('GOOGLE_CLIENT_ID') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
}
