import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ListingExtraFiltersDto } from './filter-listings.dto';

// Extends the shared filter fields (categoryId/itemCondition/priceRange/address/state/area) — no search, lat/lng/radiusKm stay this endpoint's own (not the search endpoint's useMyLocation/searchWithin pair).
export class NearbyListingsDto extends ListingExtraFiltersDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  radiusKm?: number = 5;

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
