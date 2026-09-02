import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTransactionDto {
  @IsMongoId()
  listingId: string;

  // Where Paystack redirects after payment — e.g. the app's own deep-link
  // scheme (declut://payment-callback), not a plain @IsUrl() since that
  // would reject a custom scheme. Omit to fall back to Paystack's own
  // default post-payment page.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  callbackUrl?: string;
}
