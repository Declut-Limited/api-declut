import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

// POST /transactions/:id/mark-arrived-for-inspection body (2026-10-10, explicit instruction) —
// the buyer's phone location at the moment they marked arrived, kept as dispute evidence. All
// optional: the app sends nothing if the buyer declines location twice, and the arrival still counts.
export class MarkArrivedDto {
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

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracyMeters?: number;
}
