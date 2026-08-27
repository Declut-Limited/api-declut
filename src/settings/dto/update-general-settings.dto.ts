import {
  IsEmail,
  IsISO4217CurrencyCode,
  IsOptional,
  IsString,
  IsTimeZone,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateGeneralSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  companyName?: string;

  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @IsOptional()
  @IsISO4217CurrencyCode()
  defaultCurrency?: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}
