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
  // One vendor call does the whole check: the selfie is matched against the
  // photo on this NIN's record (proving the person holding the phone owns
  // the NIN), and the name on that record is matched against `fullName`
  // (the account's User.name). Both must pass for 'verified'.
  verifyIdentity(
    nin: string,
    selfieImageBase64: string,
    fullName: string,
  ): Promise<KycCheckResult>;
}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
