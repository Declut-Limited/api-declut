import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';

// 'otp' = forgot-password OTP session; 'email_verify' = signup email
// verification. Same signed-JWT-carrying-a-bcrypt-hash shape for both, but
// the purpose claim is checked strictly on every verify — without it, an
// email-verification token could otherwise be replayed as a password-reset
// OTP token (or vice versa), since both may be signed with the same secret.
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

/**
 * Deliberately stateless — neither the OTP nor the password-reset token is
 * ever written to the database. Both are self-contained, signed JWTs the
 * *client* carries between steps (forgot-password → verify-otp →
 * reset-password), verified purely by signature + expiry + an embedded
 * fingerprint, the same way this codebase already treats access/refresh
 * JWTs as bearer credentials rather than DB lookups where it can.
 *
 * The one place a plain DB lookup would normally be needed — "has this
 * specific reset token already been used?" — is solved without any storage
 * by embedding a fingerprint of the user's CURRENT passwordHash into the
 * reset token at issue time (signResetToken). Verifying compares that
 * embedded fingerprint against the password hash's fingerprint *at
 * verification time*: the moment the password actually changes, the
 * fingerprint changes too, so the token that was used to make that change
 * (and any other older token for the same account) stops matching and is
 * permanently dead — a single-use, auto-expiring token with zero server-side
 * state. This is the same trick Django's PasswordResetTokenGenerator uses.
 *
 * Shared between the regular-user Auth module and the separate Admin auth
 * module — each passes its own secret so a leaked user-flow secret can
 * never be used to forge an admin token or vice versa. Lives in the
 * already-@Global() AuthGuardsModule (see guards.module.ts) since both
 * consumers need it and it has the same "global JWT-adjacent auth utility"
 * shape as the guards already there.
 */
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

  /**
   * Verifies signature + expiry + the `purpose` claim only — deliberately
   * does NOT compare the OTP here. Callers that just need to re-derive
   * `sub` from an unexpired token (e.g. resend-otp, which is about to issue
   * a brand new code anyway) call this instead of verifyOtp.
   */
  async decodeOtpToken(
    token: string,
    secret: string,
    purpose: OtpPurpose = 'otp',
  ): Promise<{ sub: string }> {
    const payload = await this.verifyPurpose<OtpTokenPayload>(
      token,
      secret,
      purpose,
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
  ): Promise<T> {
    let payload: T;
    try {
      payload = await this.jwtService.verifyAsync<T>(token, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // Explicit purpose check — without this, a valid OTP-session token could
    // otherwise be replayed as a reset token (or vice versa), since both are
    // signed with the same secret per audience (user or admin).
    if (payload.purpose !== purpose) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return payload;
  }
}
