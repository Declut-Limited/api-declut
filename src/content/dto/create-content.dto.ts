import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ContentStatus, ContentType } from '../schemas/content.schema';

export class CreateContentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  @IsEnum(ContentType)
  contentType: ContentType;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  whereToAppear: string;

  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body: string;
}
