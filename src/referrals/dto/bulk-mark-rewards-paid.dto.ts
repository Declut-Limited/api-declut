import { ArrayMaxSize, ArrayMinSize, IsMongoId } from 'class-validator';

export class BulkMarkRewardsPaidDto {
  @IsMongoId({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  rewardIds: string[];
}
