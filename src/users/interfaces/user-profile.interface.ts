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
  trustScore: number;
  avgRating: number;
  reviewCount: number;
  bankCode?: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  hasPayoutDetails: boolean;
  createdAt: Date;
}

// What anyone else gets to see — no email, no bank details, no raw
// kycStatus (collapsed to a boolean per CLAUDE.md's "verified flag" spec).
export interface PublicUserProfile {
  id: string;
  name: string;
  verified: boolean;
  trustScore: number;
  avgRating: number;
  reviewCount: number;
}
