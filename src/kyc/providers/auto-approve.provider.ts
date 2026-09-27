import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { KycCheckResult, KycProvider } from './kyc-provider.interface';

// Temporary stand-in for QoreIdProvider while our QoreID vendor setup is
// still incomplete (explicit instruction, 2026-09-27) — auto-approves every
// NIN/liveness check instead of calling out to a real identity-verification
// provider. Swap the binding in kyc.module.ts back to QoreIdProvider once
// QoreID is actually configured; nothing else needs to change, that's the
// whole point of the KycProvider interface boundary.
@Injectable()
export class AutoApproveKycProvider implements KycProvider {
  readonly providerName = 'auto-approve';

  verifyNin(): Promise<KycCheckResult> {
    return Promise.resolve({
      status: 'verified',
      referenceId: `AUTO-${randomUUID()}`,
    });
  }

  checkLiveness(): Promise<KycCheckResult> {
    return Promise.resolve({
      status: 'verified',
      referenceId: `AUTO-${randomUUID()}`,
    });
  }
}
