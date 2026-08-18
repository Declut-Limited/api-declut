import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListActivityLogDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // e.g. 'transaction' | 'listing' | 'review' | 'report' — not an enum
  // since entityType is a free-text string across the codebase (see
  // AuditLog schema), not a fixed set defined in one place.
  @IsOptional()
  @IsString()
  entityType?: string;
}
