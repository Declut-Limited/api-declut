import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ItemConditionFilterDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  new?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  neatlyUsed?: boolean;
}

export class PriceRangeFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  max?: number;
}

// categoryId/address/state/area/itemCondition/priceRange — shared by every listing feed (search/filter, nearby, new). No search, no geo-mode-switching (useMyLocation/lat/lng/searchWithin) — those stay exclusive to ListingFilterDto below.
export class ListingExtraFiltersDto {
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ItemConditionFilterDto)
  itemCondition?: ItemConditionFilterDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PriceRangeFilterDto)
  priceRange?: PriceRangeFilterDto;
}

export class ListingFilterDto extends ListingExtraFiltersDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  useMyLocation?: boolean;

  // Required (checked in the service, not here) when useMyLocation is true — there's no stored user location to fall back on.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  // Only applied when useMyLocation is true; no default — omitted means unlimited distance, just proximity-sorted.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  searchWithin?: number;

  // address/state/area (inherited above) only apply when useMyLocation is false/omitted — see buildListingFilterQuery().

  // Text-search query, matched against title/description (Mongo text index).
  @IsOptional()
  @IsString()
  search?: string;
}

export class FilterListingsDto extends ListingFilterDto {
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
