export interface KycCheckResult {
  status: 'verified' | 'rejected';
  referenceId: string;
  failureReason?: string;
}

// Vendor-agnostic boundary — swapping to Dojah/Youverify/Smile Identity/
// Prembly means a new class + one binding change in KycModule.
export interface KycProvider {
  verifyNin(nin: string): Promise<KycCheckResult>;
  checkLiveness(selfieImageBase64: string): Promise<KycCheckResult>;
}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
