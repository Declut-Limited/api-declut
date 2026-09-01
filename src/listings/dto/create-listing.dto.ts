import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ListingCondition } from '../schemas/listing.schema';

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

// Cloudinary's own upload-response shape, forwarded by the client after it
// uploads directly to Cloudinary via GET /media/upload-signature.
// sortOrder/isPrimary/createdAt are optional — the service defaults them
// (array index, false, now()) when omitted.
export class MediaAssetDto {
  @IsString()
  @IsNotEmpty()
  publicId: string;

  @IsUrl()
  url: string;

  @IsUrl()
  secureUrl: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsDateString()
  createdAt?: string;
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

  @IsMongoId()
  categoryId: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  address: string;

  @ValidateNested()
  @Type(() => LocationDto)
  location: LocationDto;

  @IsEnum(ListingCondition)
  condition: ListingCondition;

  @IsOptional()
  @IsBoolean()
  hasDefect?: boolean;

  // string|null via @IsOptional() — it treats both undefined and null as "skip validation".
  @IsOptional()
  @IsString()
  @MaxLength(500)
  defectDescription?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => MediaAssetDto)
  images: MediaAssetDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaAssetDto)
  video?: MediaAssetDto;
}
