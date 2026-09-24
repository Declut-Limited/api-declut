import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  MaxLength,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EndDateNotBeforeStartDateConstraint } from '../../common/dto/date-range.dto';
import {
  ReferralCampaignStatus,
  ReferralPaymentMethod,
  ReferralPaymentSchedule,
  ReferralRewardType,
} from '../schemas/referral-campaign.schema';
import {
  ReferralEligibilityDto,
  ReferralRequirementDto,
  ReferralValidationRulesDto,
} from './referral-campaign-nested.dto';

// No relaxed validation for status=draft — every field below is required
// regardless of target status, matching how Content's own draft/published
// field already behaves (a draft doesn't get a smaller required-field set
// there either). Judgment call, flagged: a "save a bare-bones draft with
// only a name and code, fill in the rest later" flow was not built; ask if
// that's actually wanted.
export class CreateReferralCampaignDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  internalCampaignCode: string;

  @IsOptional()
  @IsEnum(ReferralCampaignStatus)
  status?: ReferralCampaignStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsDateString()
  @Validate(EndDateNotBeforeStartDateConstraint)
  endDate: string;

  @IsEnum(ReferralRewardType)
  rewardType: ReferralRewardType;

  @IsNumber()
  @Min(0)
  rewardAmount: number;

  @IsNumber()
  @Min(0)
  maxCampaignBudget: number;

  // IsDefined is load-bearing — ValidateNested alone silently passes on an
  // undefined value (same gotcha caught earlier for Feedback's attachment).
  @IsDefined()
  @ValidateNested()
  @Type(() => ReferralRequirementDto)
  referralRequirement: ReferralRequirementDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  qualificationWindow?: number;

  @IsDefined()
  @ValidateNested()
  @Type(() => ReferralEligibilityDto)
  eligibility: ReferralEligibilityDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => ReferralValidationRulesDto)
  validationRules: ReferralValidationRulesDto;

  @IsEnum(ReferralPaymentMethod)
  paymentMethod: ReferralPaymentMethod;

  @IsEnum(ReferralPaymentSchedule)
  paymentSchedule: ReferralPaymentSchedule;

  // Required only when status=scheduled.
  @ValidateIf(
    (o: CreateReferralCampaignDto) =>
      o.status === ReferralCampaignStatus.SCHEDULED,
  )
  @IsDefined()
  @IsDateString()
  activationDate?: string;

  @ValidateIf(
    (o: CreateReferralCampaignDto) =>
      o.status === ReferralCampaignStatus.SCHEDULED,
  )
  @IsDefined()
  @IsString()
  activationTime?: string;
}
