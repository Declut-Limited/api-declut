import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class WaitlistInviteRecipientDto {
  @IsMongoId()
  id: string;

  @IsEmail()
  email: string;
}

export class BulkInviteWaitlistDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => WaitlistInviteRecipientDto)
  recipients: WaitlistInviteRecipientDto[];

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;
}
