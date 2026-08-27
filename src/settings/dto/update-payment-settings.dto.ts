import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdatePaymentSettingsDto {
  @IsOptional()
  @IsBoolean()
  cardPaymentsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  bankTransferEnabled?: boolean;

  // "Escrow release window" in the admin UI — reuses the existing
  // escrowStalledThresholdDays property rather than a new field.
  @IsOptional()
  @IsInt()
  @Min(1)
  escrowStalledThresholdDays?: number;

  // Moved here from the unscoped settings endpoint 2026-08-27 — the wrong
  // confirmation-code attempt limit before a transaction auto-flags
  // disputed (TransactionsService.handleWrongCode()), grouped under
  // Payments since it's part of the escrow release flow.
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCodeAttempts?: number;
}
