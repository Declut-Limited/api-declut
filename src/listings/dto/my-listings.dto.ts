import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

// Friendly filter keys for GET /listings/mine — not raw ListingStatus values.
// 'reported' maps to the existing FLAGGED status (an admin flagged it) —
// the seller-facing name for the same thing, no separate status invented.
export const MY_LISTING_STATUS_FILTERS = [
  'active',
  'pending_sale',
  'sold',
  'reported',
] as const;
export type MyListingStatusFilter = (typeof MY_LISTING_STATUS_FILTERS)[number];

export class MyListingsDto {
  @IsOptional()
  @IsIn(MY_LISTING_STATUS_FILTERS)
  status?: MyListingStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
