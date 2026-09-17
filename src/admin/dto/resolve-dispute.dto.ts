import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveDisputeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
