import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

// Base lat/lng/radiusKm shared by NearbyListingsDto (paginated) and the count-only endpoint — no page/limit here.
export class NearbyLocationDto {
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
}
