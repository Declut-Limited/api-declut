import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'bankCode must be a 3-6 digit bank code' })
  bankCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  // Nigerian NUBAN — 10 digits (Paystack's account-resolve flow validates
  // this against the actual bank when the Payments module is built).
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'accountNumber must be a 10-digit NUBAN' })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string;
}
