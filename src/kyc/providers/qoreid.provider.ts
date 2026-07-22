import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KycProvider,
  KycVerificationInput,
  KycVerificationResult,
} from './kyc-provider.interface';

/**
 * IMPORTANT — flagged, not guessed-and-hidden: I don't have QoreID's actual
 * API reference in front of me, so the endpoint path, auth flow, and
 * request/response field names below are a structurally reasonable
 * placeholder (REST + bearer token, matching how QoreID's NIN + liveness
 * product is generally described), NOT verified against real docs. Before
 * this touches real QoreID credentials: pull the actual API reference from
 * your QoreID dashboard and correct verifyIdentity() to match — the
 * KycProvider interface and everything calling it (KycService, the
 * controller, User.kycStatus updates) will not need to change regardless of
 * what the real payload shape turns out to be, which is the point of the
 * interface boundary.
 */
@Injectable()
export class QoreIdProvider implements KycProvider {
  constructor(private readonly config: ConfigService) {}

  async verifyIdentity(input: KycVerificationInput): Promise<KycVerificationResult> {
    const baseUrl = this.config.get<string>('QOREID_BASE_URL');
    const clientId = this.config.get<string>('QOREID_CLIENT_ID');
    const clientSecret = this.config.get<string>('QOREID_CLIENT_SECRET');

    if (!baseUrl || !clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'KYC verification is not configured on this server yet',
      );
    }

    const response = await fetch(`${baseUrl}/v1/ng/identities/nin-liveness`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
      },
      body: JSON.stringify({
        nin: input.nin,
        selfieImage: input.selfieImageBase64,
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException('KYC provider request failed');
    }

    const data = (await response.json()) as {
      status: string;
      referenceId: string;
      reason?: string;
    };

    const verified = data.status === 'verified' || data.status === 'pass';

    return {
      status: verified ? 'verified' : 'rejected',
      referenceId: data.referenceId,
      failureReason: verified ? undefined : (data.reason ?? 'Verification failed'),
    };
  }
}
