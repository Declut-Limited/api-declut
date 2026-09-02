import { IsString, Matches } from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'bankCode must be a 3-6 digit bank code' })
  bankCode: string;

  // Nigerian NUBAN — 10 digits. Cross-checked against Paystack's bank list
  // and resolved to an account holder name server-side before this is stored.
  @IsString()
  @Matches(/^\d{10}$/, { message: 'accountNumber must be a 10-digit NUBAN' })
  accountNumber: string;
}
