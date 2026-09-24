import { IsOptional, IsString, MinLength } from 'class-validator';

export class ReactivateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  reactivationReason?: string;
}
