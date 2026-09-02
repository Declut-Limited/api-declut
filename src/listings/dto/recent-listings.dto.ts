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
}
