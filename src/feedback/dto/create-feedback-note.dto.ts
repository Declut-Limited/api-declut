import { IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateFeedbackNoteDto {
  @IsMongoId()
  feedbackId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description: string;
}
