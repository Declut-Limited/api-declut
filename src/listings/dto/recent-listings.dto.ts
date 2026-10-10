import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ListingExtraFiltersDto } from './filter-listings.dto';

// Extends the shared filter fields (categoryId/itemCondition/priceRange/address/state/area) — no search, no geo (this feed has never had a location mechanism).
export class RecentListingsDto extends ListingExtraFiltersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  // How far back "recently posted" reaches, in days (2026-10-10) — set from the app's Recently
  // Posted filter. Omitted = RECENT_LISTINGS_DAYS (14) in listings.service.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  postedWithinDays?: number;
}
