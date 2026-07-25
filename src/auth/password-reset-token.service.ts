import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';

// 'otp' = forgot-password; 'email_verify' = signup verification. Checked
// strictly so one purpose's token can't be replayed as the other.
type OtpPurpose = 'otp' | 'email_verify';

interface OtpTokenPayload {
  sub: string;
  otpHash: string;
  purpose: OtpPurpose;
}

interface ResetTokenPayload {
  sub: string;
  fp: string;
  purpose: 'reset';
}

// Stateless — OTP and reset tokens are signed JWTs the client carries
// between steps, never stored in the DB. Reset-token single-use comes from
// embedding a fingerprint of the CURRENT password hash: once the password
// changes, the fingerprint changes too, so the token dies automatically.
// Shared by both the User and Admin auth modules, each with its own secret.
@Injectable()
export class PasswordResetTokenService {
  constructor(private readonly jwtService: JwtService) {}

  generateOtp(): string {
    // Cryptographically secure — this code gates a real credential change,
    // not just a display value.
    return randomInt(100000, 1000000).toString();
  }

  async signOtpToken(params: {
    sub: string;
    otp: string;
    secret: string;
    expiresIn: string;
    saltRounds: number;
    purpose?: OtpPurpose;
  }): Promise<string> {
    const otpHash = await bcrypt.hash(params.otp, params.saltRounds);
    const payload: OtpTokenPayload = {
      sub: params.sub,
      otpHash,
      purpose: params.purpose ?? 'otp',
    };
    return this.jwtService.signAsync(payload, {
      secret: params.secret,
      expiresIn: params.expiresIn as StringValue,
    });
  }

  // Verifies signature + purpose only, ignoring expiry — resend-otp's whole
  // job is handling a token whose OTP already expired, so it must still
  // decode an expired-but-signature-valid token to find out who to resend to.
  async decodeOtpToken(
    token: string,
    secret: string,
    purpose: OtpPurpose = 'otp',
  ): Promise<{ sub: string }> {
    const payload = await this.verifyPurpose<OtpTokenPayload>(
      token,
      secret,
      purpose,
      { ignoreExpiration: true },
    );
    return { sub: payload.sub };
  }

  async verifyOtp(
    token: string,
    otp: string,
    secret: string,
    purpose: OtpPurpose = 'otp',
  ): Promise<{ sub: string }> {
    const payload = await this.verifyPurpose<OtpTokenPayload>(
      token,
      secret,
      purpose,
    );
    const matches = await bcrypt.compare(otp, payload.otpHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    return { sub: payload.sub };
  }

  async signResetToken(params: {
    sub: string;
    passwordHash: string;
    secret: string;
    expiresIn: string;
  }): Promise<string> {
    const payload: ResetTokenPayload = {
      sub: params.sub,
      fp: this.fingerprint(params.passwordHash),
      purpose: 'reset',
    };
    return this.jwtService.signAsync(payload, {
      secret: params.secret,
      expiresIn: params.expiresIn as StringValue,
    });
  }

  /**
   * currentPasswordHash must be read fresh from the DB by the caller right
   * before calling this — that's what makes the single-use property work.
   */
  async verifyResetToken(
    token: string,
    currentPasswordHash: string | undefined,
    secret: string,
  ): Promise<{ sub: string }> {
    const payload = await this.verifyPurpose<ResetTokenPayload>(
      token,
      secret,
      'reset',
    );
    if (
      !currentPasswordHash ||
      this.fingerprint(currentPasswordHash) !== payload.fp
    ) {
      throw new UnauthorizedException(
        'This reset link has already been used or is no longer valid — request a new one',
      );
    }
    return { sub: payload.sub };
  }

  fingerprint(passwordHash: string): string {
    return createHash('sha256').update(passwordHash).digest('hex').slice(0, 32);
  }

  private async verifyPurpose<T extends { purpose: string }>(
    token: string,
    secret: string,
    purpose: T['purpose'],
    options?: { ignoreExpiration?: boolean },
  ): Promise<T> {
    let payload: T;
    try {
      payload = await this.jwtService.verifyAsync<T>(token, {
        secret,
        ignoreExpiration: options?.ignoreExpiration,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.purpose !== purpose) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return payload;
  }
}
