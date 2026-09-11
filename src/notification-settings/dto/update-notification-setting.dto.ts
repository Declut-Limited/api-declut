import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';

class UpdateNotificationChannelsDto {
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;
}

// paymentAndEscrowUpdates/listingActivity/productUpdates/referralAndRewards
// are deliberately absent — required, not user-toggleable (see the schema).
export class UpdateNotificationSettingDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateNotificationChannelsDto)
  channels?: UpdateNotificationChannelsDto;

  @IsOptional()
  @IsBoolean()
  transactionUpdates?: boolean;

  @IsOptional()
  @IsBoolean()
  inspectionReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  disputeUpdates?: boolean;
}
