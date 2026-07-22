import { IsMongoId, IsOptional } from 'class-validator';

export class CreateTransactionDto {
  @IsMongoId()
  listingId: string;

  // If provided, must be an offer the caller is the buyer on, in 'accepted'
  // status, on this same listing — its amount becomes the transaction price
  // instead of the listing's list price.
  @IsOptional()
  @IsMongoId()
  offerId?: string;
}
