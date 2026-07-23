import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ListingStatus } from '../../listings/schemas/listing.schema';
import { TransactionStatus } from '../../transactions/schemas/transaction.schema';

class PageDto {
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

export class AdminListUsersDto extends PageDto {}

export class AdminListListingsDto extends PageDto {
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;
}

export class AdminListTransactionsDto extends PageDto {
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;
}

export class AdminListOffersDto extends PageDto {}
