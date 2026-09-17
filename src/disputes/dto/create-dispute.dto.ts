import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MediaAssetDto } from '../../listings/dto/create-listing.dto';

export class CreateDisputeDto {
  @IsMongoId()
  transactionId: string;

  @IsMongoId()
  reportId: string;

  @MinLength(10)
  @MaxLength(2000)
  disputeClaim: string;

  // Exactly 2 — per explicit instruction.
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => MediaAssetDto)
  evidenceImages: MediaAssetDto[];

  // A single required video, same shape as Listing.video — not an array.
  @ValidateNested()
  @Type(() => MediaAssetDto)
  evidenceVideo: MediaAssetDto;
}
