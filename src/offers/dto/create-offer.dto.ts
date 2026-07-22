import { IsMongoId, IsNumber, Min } from 'class-validator';

export class CreateOfferDto {
  @IsMongoId()
  listingId: string;

  @IsNumber()
  @Min(1)
  amount: number;
}
