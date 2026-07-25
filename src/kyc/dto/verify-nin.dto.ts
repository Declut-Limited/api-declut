import { IsString, Matches } from 'class-validator';

export class VerifyNinDto {
  @IsString()
  @Matches(/^\d{11}$/, { message: 'nin must be an 11-digit NIN' })
  nin: string;
}
