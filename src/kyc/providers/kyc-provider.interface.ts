export interface KycVerificationInput {
  nin: string;
  selfieImageBase64: string;
}

export interface KycVerificationResult {
  status: 'verified' | 'rejected';
  referenceId: string;
  failureReason?: string;
}

/**
 * Vendor-agnostic boundary — KycService depends on this, never on QoreID
 * directly. Swapping to Dojah/Youverify/Smile Identity/Prembly later means
 * writing one new class and changing the provider binding in KycModule,
 * with zero changes to KycService or the controller.
 */
export interface KycProvider {
  verifyIdentity(input: KycVerificationInput): Promise<KycVerificationResult>;
}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
