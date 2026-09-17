import {
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateReportDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason: string;

  @IsOptional()
  @IsMongoId()
  listingId?: string;

  // The specific purchase this report is about, if any — explicit
  // instruction, 2026-09-17: the client now tells us directly which
  // transaction to freeze, rather than us inferring an "active" one from
  // listingId + the caller's own id.
  @IsOptional()
  @IsMongoId()
  transactionId?: string;

  // Only needed when reporting a user directly, with no listing involved —
  // when listingId is given, the accused user is derived server-side from
  // the listing's own seller instead (explicit instruction, 2026-09-17),
  // and any value sent here is ignored.
  @IsOptional()
  @IsMongoId()
  accusedUserId?: string;

  // The user who actually filed this dispute — not the target being reported.
  @IsMongoId()
  reporterId: string;
}
