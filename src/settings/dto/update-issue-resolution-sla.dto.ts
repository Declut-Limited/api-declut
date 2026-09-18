import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateIssueResolutionSlaDto {
  // Master switch — when false, the other four fields are stored but
  // meaningless (nothing currently reads any of them either way).
  @IsOptional()
  @IsBoolean()
  enableSellerSLA?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  sellerResponseSlaTimeInHour?: number;

  @IsOptional()
  @IsBoolean()
  autoEscalateSlaOnExpiry?: boolean;

  @IsOptional()
  @IsBoolean()
  sendSlaReminderBeforeDeadline?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  reminderSlaTimeInHour?: number;
}
