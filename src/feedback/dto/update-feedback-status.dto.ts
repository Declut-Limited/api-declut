import {
  IsEnum,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  EscalationReason,
  EscalationTeam,
  FeedbackStatus,
} from '../schemas/feedback.schema';

// No 'new' here — there's no "mark as new" admin action, feedback only ever
// starts there on its own.
const UPDATABLE_STATUSES = [
  FeedbackStatus.IN_REVIEW,
  FeedbackStatus.RESOLVED,
  FeedbackStatus.ESCALATED,
] as const;

export class UpdateFeedbackStatusDto {
  @IsIn(UPDATABLE_STATUSES)
  status: FeedbackStatus;

  // The three escalation fields are required only when status=escalated —
  // @IsEnum/@IsString both correctly reject an absent value on their own
  // (unlike @ValidateNested, no extra @IsDefined() needed here).
  @ValidateIf(
    (o: UpdateFeedbackStatusDto) => o.status === FeedbackStatus.ESCALATED,
  )
  @IsEnum(EscalationTeam)
  escalatedTo?: EscalationTeam;

  @ValidateIf(
    (o: UpdateFeedbackStatusDto) => o.status === FeedbackStatus.ESCALATED,
  )
  @IsEnum(EscalationReason)
  escalatedReason?: EscalationReason;

  @ValidateIf(
    (o: UpdateFeedbackStatusDto) => o.status === FeedbackStatus.ESCALATED,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  escalatedInternalNote?: string;
}
