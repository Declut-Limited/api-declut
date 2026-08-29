import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'endDateNotBeforeStartDate', async: false })
class EndDateNotBeforeStartDateConstraint implements ValidatorConstraintInterface {
  validate(endDate: string, args: ValidationArguments): boolean {
    const { startDate } = args.object as { startDate?: string };
    if (!startDate || !endDate) return true;
    return new Date(endDate) >= new Date(startDate);
  }

  defaultMessage(): string {
    return 'endDate must not be earlier than startDate';
  }
}

// Shared by every admin list/export endpoint's date filter — plain
// YYYY-MM-DD (or full ISO) strings, both optional, independently usable.
// endDate == startDate is valid (same-day range); endDate < startDate is not.
export class DateRangeDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @Validate(EndDateNotBeforeStartDateConstraint)
  endDate?: string;
}

// DateRangeDto plus the page/limit pair every paginated list endpoint needs
// — one shared base so pagination + date filtering aren't redeclared per module.
export class PaginatedDateRangeDto extends DateRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
