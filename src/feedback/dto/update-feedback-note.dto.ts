import { IsString, MaxLength, MinLength } from 'class-validator';

// Only description is editable — feedbackId/writtenBy are fixed at creation
// and can never be changed, so neither is on this DTO at all
// (forbidNonWhitelisted 400s a stray attempt to send either). Mirrors
// UpdateTransactionNoteDto exactly.
export class UpdateFeedbackNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description: string;
}
