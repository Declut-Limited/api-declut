import {
  IsEnum,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { InspectionReminderType } from '../../transactions/dto/inspection-reminder-type.enum';

export class SendInspectionReminderDto {
  @IsEnum(InspectionReminderType)
  reminderType: InspectionReminderType;

  // No 'both' — the admin picks exactly one channel per explicit instruction.
  @IsIn(['push', 'email'])
  channel: 'push' | 'email';

  // Required only when reminderType is 'custom_message' — the admin's own
  // wording, sent verbatim as the notification body.
  @ValidateIf(
    (o: SendInspectionReminderDto) =>
      o.reminderType === InspectionReminderType.CUSTOM_MESSAGE,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message?: string;
}
