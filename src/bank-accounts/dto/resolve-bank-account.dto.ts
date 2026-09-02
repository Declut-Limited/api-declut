import { IsString, Matches } from 'class-validator';

export class ResolveBankAccountDto {
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'bankCode must be a 3-6 digit bank code' })
  bankCode: string;

  @IsString()
  @Matches(/^\d{10}$/, { message: 'accountNumber must be a 10-digit NUBAN' })
  accountNumber: string;
}
