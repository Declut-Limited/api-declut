import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const PURCHASE_STATUS_FILTERS = [
  'active',
  'completed',
  'refunded',
  'disputed',
] as const;
export type PurchaseStatusFilter = (typeof PURCHASE_STATUS_FILTERS)[number];

export class ListPurchasesDto {
  @IsOptional()
  @IsIn(PURCHASE_STATUS_FILTERS)
  status?: PurchaseStatusFilter;

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
