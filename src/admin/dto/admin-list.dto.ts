import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { ListingStatus } from '../../listings/schemas/listing.schema';
import { TransactionStatus } from '../../transactions/schemas/transaction.schema';
import { AccountStatus } from '../../users/schemas/user.schema';
import { ReviewStatus } from '../../reviews/schemas/review.schema';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';

// Kept as its own name (rather than inlining PaginatedDateRangeDto everywhere)
// since every admin list DTO below already extends PageDto.
export class PageDto extends PaginatedDateRangeDto {}

export class AdminListUsersDto extends PageDto {
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  // Narrows the federated Users+Admins list to one account type. 'all' is
  // the default (both), same "accept 'all' explicitly" convention as
  // AdminListListingsDto.status above.
  @IsOptional()
  @IsIn(['all', 'user', 'admin'])
  type?: 'all' | 'user' | 'admin';

  @IsOptional()
  @IsString()
  search?: string;
}

// 'paused' excluded from the allowed values below, 2026-09-13 — a paused
// listing is a private seller draft, invisible to admin the same way it's
// invisible to every other non-owner (see ListingStatus.PAUSED). ListingsService.adminList()/adminFindDetail() also unconditionally exclude it, so this is belt-and-suspenders — an explicit ?status=paused now 400s instead of silently returning nothing.
const ADMIN_VISIBLE_LISTING_STATUSES = Object.values(ListingStatus).filter(
  (status) => status !== ListingStatus.PAUSED,
);

export class AdminListListingsDto extends PageDto {
  // 'all' is accepted alongside the real statuses so the client can pass it
  // explicitly rather than needing to know "omit the param" means the same
  // thing — AdminService treats both identically (no filter).
  @IsOptional()
  @IsIn([...ADMIN_VISIBLE_LISTING_STATUSES, 'all'])
  status?: ListingStatus | 'all';

  @IsOptional()
  @IsString()
  search?: string;
}

// 'stalled' removed 2026-09-13 — TransactionStatus.STALLED no longer exists, see the Transactions schema.
const TRANSACTION_TABS = [
  'all',
  'active',
  'completed',
  'disputed',
  'refunded',
] as const;
export type TransactionTab = (typeof TRANSACTION_TABS)[number];

export class AdminListTransactionsDto extends PageDto {
  // One param, not two (was `status` + `tab` separately — renamed
  // 2026-09-17, explicit instruction: "anywhere you're using tab to filter
  // status, should be status"). Accepts either a grouped/friendly value
  // (`all`/`active`/`completed`/`disputed`/`refunded` — "active" spans
  // pending_payment/escrow_active/awaiting_inspection, "refunded" folds in
  // cancelled too, see AdminService.TAB_STATUS_MAP) or an exact raw
  // TransactionStatus value (e.g. `escrow_active`, `cancelled` on its own).
  // `all` always returns everything, unfiltered, same as omitting the param.
  @IsOptional()
  @IsIn([...TRANSACTION_TABS, ...Object.values(TransactionStatus)])
  status?: TransactionTab | TransactionStatus;
}

export class AdminListReviewsDto extends PageDto {
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;
}
