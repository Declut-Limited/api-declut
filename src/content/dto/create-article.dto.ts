import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateArticleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body: string;
}
