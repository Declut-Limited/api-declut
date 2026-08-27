import { IsMongoId } from 'class-validator';

export class CreateTransactionDto {
  @IsMongoId()
  listingId: string;
}
