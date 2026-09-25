import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Independent pagination for the detail view's two sub-tables (this
// participant's own referrals, and their referred users' real marketplace
// transactions) — named distinctly so both can be paginated in the same
// request without colliding.
export class ReferralParticipantDetailDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  referralsPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  referralsLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  transactionsPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  transactionsLimit?: number;
}
