import { IsEmail, IsEnum } from 'class-validator';
import { WaitlistInterest } from '../schemas/waitlist.schema';

export class JoinWaitlistDto {
  @IsEmail()
  email: string;

  @IsEnum(WaitlistInterest)
  interest: WaitlistInterest;
}
