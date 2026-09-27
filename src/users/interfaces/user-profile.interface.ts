import { AccountStatus, AuthProvider, KycStatus } from '../schemas/user.schema';

// Full profile — only ever returned to the user themselves.
export interface PrivateUserProfile {
  id: string;
  email: string;
  phone?: string;
  name: string;
  authProvider: AuthProvider;
  emailVerified: boolean;
  kycStatus: KycStatus;
  kyc: { verifiedNIN: boolean; livenessChecked: boolean };
  accountStatus: AccountStatus;
  slug?: string;
  avgRating: number;
  reviewCount: number;
  hasPayoutDetails: boolean;
  profileImageUrl?: string;
  trustScore: number;
  // Admin-visible elsewhere (GET /admin/users list, user detail by
  // id/slug) — the one exception is the user's own GET /users/me. Never on
  // PublicUserProfile below.
  policyStrike: number;
  listingCount: number;
  soldCount: number;
  purchaseCount: number;
  totalAmountInEscrow: number;
  createdAt: Date;
  lastSeenAt?: Date | null;
}

// What anyone else gets to see — no email, no bank details, no raw
// kycStatus (collapsed to a boolean per CLAUDE.md's "verified flag" spec).
export interface PublicUserProfile {
  id: string;
  name: string;
  verified: boolean;
  avgRating: number;
  reviewCount: number;
  hasPayoutDetails: boolean;
}
