import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminRefundDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
