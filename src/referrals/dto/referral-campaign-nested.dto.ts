import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import {
  EligibleLocation,
  EligibleUsers,
  ReferredTaskType,
} from '../schemas/referral-campaign.schema';

// Shared by create + update — on update the whole object is optional, but
// once given it's replaced wholesale (every field below still required),
// same "sent as a whole object, not individually mergeable" convention
// UpdatePaymentSettingsDto's inspectionWindow already uses.
export class ReferralRequirementDto {
  @IsInt()
  @Min(1)
  referralAmount: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ReferredTaskType, { each: true })
  eachReferredTask: ReferredTaskType[];

  @IsNumber()
  @Min(0)
  minimumTransactionValueCompletedSale: number;

  @IsNumber()
  @Min(0)
  minimumTransactionValueCompletedTransaction: number;
}

export class ReferralEligibilityDto {
  @IsEnum(EligibleUsers)
  eligibleUsers: EligibleUsers;

  @IsEnum(EligibleLocation)
  eligibleLocation: EligibleLocation;
}

export class ReferralValidationRulesDto {
  @IsBoolean()
  transactionCompleted: boolean;

  @IsBoolean()
  escrowReleased: boolean;

  @IsBoolean()
  notRefunded: boolean;

  @IsBoolean()
  notDisputed: boolean;

  @IsBoolean()
  notFlagged: boolean;

  @IsBoolean()
  meetsMinimumTransactionAmount: boolean;
}
