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

export class ListingFilterDto {
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

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

  // Only applied when useMyLocation is false/omitted.
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
