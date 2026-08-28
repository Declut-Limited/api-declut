import { Types } from 'mongoose';

// Shared shape for a populated buyer/seller reference — used anywhere a
// User needs to be shown as one side of a money-moving relationship
// (Transactions, Escrow).
export interface PopulatedParty {
  _id: Types.ObjectId;
  name: string;
  email: string;
  accountStatus: string;
  slug?: string;
  company?: string;
}

// rolePlayed is derived from which field is being shaped, not stored.
// Null-safe — a ref can populate to null for stale/orphaned test data (see
// CLAUDE.md's ObjectId schema bug note), and that shouldn't 500 the response.
export function shapeParty(
  user: PopulatedParty | null,
  rolePlayed: 'buyer' | 'seller',
): Record<string, unknown> | null {
  if (!user) return null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    status: user.accountStatus,
    rolePlayed,
    slug: user.slug,
    company: user.company,
  };
}
