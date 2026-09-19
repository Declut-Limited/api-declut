import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FeedbackCategory } from '../schemas/feedback.schema';
import { MediaAssetDto } from '../../listings/dto/create-listing.dto';

export class CreateFeedbackDto {
  @IsEnum(FeedbackCategory)
  category: FeedbackCategory;

  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  feedbackDescription: string;

  @IsOptional()
  @IsBoolean()
  canContactMe?: boolean;

  // Required only when reporting a problem — client uploads to Cloudinary
  // first (GET /media/upload-signature) and forwards the resulting object,
  // same as every other media field in this app. IsDefined is load-bearing
  // here: ValidateNested alone silently passes on an undefined value, so
  // without it a missing screenshot would slip through uncaught.
  @ValidateIf(
    (o: CreateFeedbackDto) => o.category === FeedbackCategory.REPORT_PROBLEM,
  )
  @IsDefined({ message: 'screenshot is required when reporting a problem' })
  @ValidateNested()
  @Type(() => MediaAssetDto)
  screenshot?: MediaAssetDto;

  @IsInt()
  @Min(1)
  @Max(5)
  experience: number;
}
