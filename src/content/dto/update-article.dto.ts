import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateArticleDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body?: string;
}
