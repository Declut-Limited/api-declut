import { IsString, MinLength } from 'class-validator';

export class UnsuspendUserDto {
  @IsString()
  @MinLength(3)
  unsuspensionReason: string;
}
