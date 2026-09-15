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

// paymentAndEscrowUpdates/listingActivity/productUpdates/inspectionReminders
// are deliberately absent — required, not user-toggleable (see the schema).
// inspectionReminders moved into this excluded group 2026-09-16 (was
// user-toggleable); referralAndRewards moved the other way the same day
// (was excluded, now toggleable below) — both explicit instruction.
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
  disputeUpdates?: boolean;

  @IsOptional()
  @IsBoolean()
  referralAndRewards?: boolean;
}
