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

// Every field optional (partial update). Nested objects (referralRequirement/
// eligibility/validationRules) are replaced wholesale when given, not merged
// field-by-field — same convention UpdatePaymentSettingsDto's
// inspectionWindow already uses. The service enforces the actual
// "only editable while draft or scheduled" rule — not this DTO.
export class UpdateReferralCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  internalCampaignCode?: string;

  @IsOptional()
  @IsEnum(ReferralCampaignStatus)
  status?: ReferralCampaignStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @Validate(EndDateNotBeforeStartDateConstraint)
  endDate?: string;

  @IsOptional()
  @IsEnum(ReferralRewardType)
  rewardType?: ReferralRewardType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rewardAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxCampaignBudget?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReferralRequirementDto)
  referralRequirement?: ReferralRequirementDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  qualificationWindow?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReferralEligibilityDto)
  eligibility?: ReferralEligibilityDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReferralValidationRulesDto)
  validationRules?: ReferralValidationRulesDto;

  @IsOptional()
  @IsEnum(ReferralPaymentMethod)
  paymentMethod?: ReferralPaymentMethod;

  @IsOptional()
  @IsEnum(ReferralPaymentSchedule)
  paymentSchedule?: ReferralPaymentSchedule;

  // Required together only when this request itself sets status=scheduled —
  // an unrelated edit to an already-scheduled campaign doesn't need to
  // resend these.
  @ValidateIf(
    (o: UpdateReferralCampaignDto) =>
      o.status === ReferralCampaignStatus.SCHEDULED,
  )
  @IsDefined()
  @IsDateString()
  activationDate?: string;

  @ValidateIf(
    (o: UpdateReferralCampaignDto) =>
      o.status === ReferralCampaignStatus.SCHEDULED,
  )
  @IsDefined()
  @IsString()
  activationTime?: string;
}
