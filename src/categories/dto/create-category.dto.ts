import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CategoryStatus } from '../schemas/category.schema';

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  title: string;

  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;
}
