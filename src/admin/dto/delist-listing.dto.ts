import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Fixed list an admin picks from on a manual delist — shown to the seller
// as the bold line on the app's Delist Details screen. Stored as the label
// itself (not a key) so the app and the admin dashboard can show it as-is.
// Added 2026-10-10, explicit instruction.
export const DELIST_REASONS = [
  'Prohibited item',
  'Prohibited item condition',
  'Counterfeit or fake item',
  'Misleading description or photos',
  'Inappropriate content',
  'Duplicate listing',
  'Suspected scam or fraud',
  'Other policy violation',
] as const;

// Set automatically by adminDelistFromDispute() — not in DELIST_REASONS,
// an admin can't pick it on a manual delist.
export const DISPUTE_DELIST_REASON = 'Buyer report upheld';

export class DelistListingDto {
  @IsIn(DELIST_REASONS)
  reason: (typeof DELIST_REASONS)[number];

  // Optional — the app falls back to a default explanation when omitted.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
