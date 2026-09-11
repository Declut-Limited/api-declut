import { IsString, Matches } from 'class-validator';

export class ConfirmCodeDto {
  @IsString()
  @Matches(/^\d{4}$/, { message: 'code must be a 4-digit code' })
  code: string;
}
