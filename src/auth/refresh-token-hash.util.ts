import { createHash, timingSafeEqual } from 'crypto';

// bcrypt truncates input at 72 bytes — JWTs for the same user share an
// identical header+sub prefix well past that, so bcrypt can't tell tokens
// apart. Refresh tokens are already high-entropy, so a plain SHA-256 hash +
// constant-time compare is both correct and appropriate here (unlike
// passwords, there's no benefit to bcrypt's slow adaptive hashing).
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenMatches(
  token: string,
  storedHash: string,
): boolean {
  const presented = Buffer.from(hashRefreshToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return (
    presented.length === stored.length && timingSafeEqual(presented, stored)
  );
}
