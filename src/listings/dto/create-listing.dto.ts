import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ListingCategory, ListingCondition } from '../schemas/listing.schema';

class LocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class CreateListingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @IsEnum(ListingCategory)
  category: ListingCategory;

  @IsEnum(ListingCondition)
  condition: ListingCondition;

  @IsNumber()
  @Min(0)
  price: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  images: string[];

  @ValidateNested()
  @Type(() => LocationDto)
  location: LocationDto;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  locationLabel: string;
}
