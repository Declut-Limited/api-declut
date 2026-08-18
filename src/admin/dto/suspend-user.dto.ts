import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class SuspendUserDto {
  @IsString()
  @MinLength(3)
  reason: string;

  @IsInt()
  @Min(1)
  durationDays: number;

  @IsString()
  @MinLength(1)
  outcome: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
