import { randomInt } from 'crypto';

// Excludes visually ambiguous characters (0/O, 1/l/I) — this password is
// meant to be read off an invite email and typed at least once.
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

// Guarantees at least one char from each category (not left to chance),
// rest filled randomly from the full set, then shuffled so the guaranteed
// chars aren't always in the same position. Used only by
// AdminAuthService.createSubAdmin() — a sub-admin's password is never
// client-supplied anymore, see CreateSubAdminDto.
export function generateSecurePassword(length = 16): string {
  const required = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: length - required.length }, () =>
    pick(ALL),
  );
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
