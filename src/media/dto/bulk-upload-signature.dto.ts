import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class BulkUploadSignatureDto {
  // Matches CreateListingDto.images' max of 3 — this endpoint exists to back that limit specifically.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  count?: number = 3;
}
