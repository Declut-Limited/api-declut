import { AuthProvider, KycStatus, UserRole } from '../schemas/user.schema';

// Full profile — only ever returned to the user themselves.
export interface PrivateUserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  authProvider: AuthProvider;
  kycStatus: KycStatus;
  trustScore: number;
  avgRating: number;
  reviewCount: number;
  bankCode?: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
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
