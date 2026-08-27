import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ListingStatus } from '../../listings/schemas/listing.schema';
import { TransactionStatus } from '../../transactions/schemas/transaction.schema';
import { AccountStatus } from '../../users/schemas/user.schema';
import { ReviewStatus } from '../../reviews/schemas/review.schema';

export class PageDto {
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
}

export class AdminListUsersDto extends PageDto {
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @IsOptional()
  @IsString()
  search?: string;
}

export class AdminListListingsDto extends PageDto {
  // 'all' is accepted alongside the real statuses so the client can pass it
  // explicitly rather than needing to know "omit the param" means the same
  // thing — AdminService treats both identically (no filter).
  @IsOptional()
  @IsIn([...Object.values(ListingStatus), 'all'])
  status?: ListingStatus | 'all';

  @IsOptional()
  @IsString()
  search?: string;
}

const TRANSACTION_TABS = [
  'all',
  'active',
  'completed',
  'disputed',
  'stalled',
  'refunded',
] as const;
export type TransactionTab = (typeof TRANSACTION_TABS)[number];

export class AdminListTransactionsDto extends PageDto {
  // Exact single-status filter — takes precedence over `tab` when both are
  // given.
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  // Groups related statuses for an admin UI's tab strip (e.g. "active"
  // spans pending_payment/escrow_active/awaiting_inspection) — see
  // AdminService.listTransactions() for the exact grouping, a judgment call
  // since CLAUDE.md's spec named the tabs without defining their groupings.
  @IsOptional()
  @IsIn(TRANSACTION_TABS)
  tab?: TransactionTab;
}

export class AdminListReviewsDto extends PageDto {
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;
}
