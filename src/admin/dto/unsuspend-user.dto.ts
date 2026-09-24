import { IsOptional, IsString, MinLength } from 'class-validator';

export class UnsuspendUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  unsuspensionReason?: string;
}
