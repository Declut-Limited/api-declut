export interface KycCheckResult {
  // 'pending' = no automated decision was made (manual-review mode,
  // useKycProvider: false) — an admin must decide via the override endpoint.
  // Only KycService's own manual branch produces this; a real KycProvider
  // implementation only ever returns verified/rejected.
  status: 'verified' | 'rejected' | 'pending';
  referenceId: string;
  failureReason?: string;
}

// Vendor-agnostic boundary — swapping to Dojah/Youverify/Smile Identity/
// Prembly means a new class + one binding change in KycModule.
export interface KycProvider {
  // Recorded onto each KycVerification row so the audit trail honestly
  // shows which provider actually made the call (e.g. 'auto-approve' vs
  // 'qoreid') rather than defaulting to a misleading value.
  readonly providerName: string;
  verifyNin(nin: string): Promise<KycCheckResult>;
  checkLiveness(selfieImageBase64: string): Promise<KycCheckResult>;
}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
