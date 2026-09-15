import { IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTransactionNoteDto {
  @IsMongoId()
  transactionId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description: string;
}
