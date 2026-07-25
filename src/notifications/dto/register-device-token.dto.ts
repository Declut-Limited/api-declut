import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDeviceTokenDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(10, { each: true })
  tokens: string[];
}
