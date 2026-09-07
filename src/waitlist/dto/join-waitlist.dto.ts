import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { WaitlistInterest } from '../schemas/waitlist.schema';

export class JoinWaitlistDto {
  @IsEmail()
  email: string;

  @IsEnum(WaitlistInterest)
  interest: WaitlistInterest;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
}
