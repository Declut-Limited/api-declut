import { IsNumber, Min } from 'class-validator';

export class CounterOfferDto {
  @IsNumber()
  @Min(1)
  amount: number;
}
