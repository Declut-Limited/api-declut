import {
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateReportDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason: string;

  @IsOptional()
  @IsMongoId()
  listingId?: string;

  @IsOptional()
  @IsMongoId()
  userId?: string;

  // The user who actually filed this dispute — not the target being reported.
  @IsMongoId()
  reporterId: string;
}
