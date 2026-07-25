import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycCheckResult, KycProvider } from './kyc-provider.interface';

// HONESTY FLAG: endpoint paths/payload shapes are a placeholder — not
// verified against QoreID's real docs. Confirm before using real credentials.
@Injectable()
export class QoreIdProvider implements KycProvider {
  constructor(private readonly config: ConfigService) {}

  async verifyNin(nin: string): Promise<KycCheckResult> {
    return this.call('/v1/ng/identities/nin', { nin });
  }

  async checkLiveness(selfieImageBase64: string): Promise<KycCheckResult> {
    return this.call('/v1/ng/identities/liveness', {
      selfieImage: selfieImageBase64,
    });
  }

  private async call(
    path: string,
    body: Record<string, string>,
  ): Promise<KycCheckResult> {
    const baseUrl = this.config.get<string>('QOREID_BASE_URL');
    const clientId = this.config.get<string>('QOREID_CLIENT_ID');
    const clientSecret = this.config.get<string>('QOREID_CLIENT_SECRET');

    if (!baseUrl || !clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'KYC verification is not configured on this server yet',
      );
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
      },
      body: JSON.stringify(body),
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
      failureReason: verified
        ? undefined
        : (data.reason ?? 'Verification failed'),
    };
  }
}
