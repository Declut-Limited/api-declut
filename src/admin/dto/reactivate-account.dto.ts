import { IsString, MinLength } from 'class-validator';

export class ReactivateAccountDto {
  @IsString()
  @MinLength(3)
  reactivationReason: string;
}
