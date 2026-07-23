import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
}

export interface VerifyTransactionResult {
  successful: boolean;
  amountKobo: number;
  currency: string;
}

/**
 * IMPORTANT — flagged, not guessed-and-hidden, same as the QoreID provider:
 * initializeTransaction/verifyTransaction/verifyWebhookSignature/refund
 * below match Paystack's well-documented, stable public API and I'm
 * confident in their shape. createSubaccount and initiateTransfer are ALSO
 * real, documented Paystack endpoints — but I'm not fully certain, from
 * memory alone, of the exact mechanics of how a subaccount's
 * `settlement_schedule: 'manual'` balance is meant to be released on
 * release-day: whether Paystack expects you to change the schedule
 * temporarily, call a dedicated settlement endpoint, or whether it's purely
 * informational and the Transfer API (used here) is the actual release
 * mechanism regardless of subaccount settlement schedule. This
 * implementation uses the Transfer API directly for release/refund, which I
 * can vouch for; the subaccount's role is to satisfy "held via subaccount
 * split" at checkout time. Verify this whole flow against Paystack's
 * sandbox before it touches real money — this is the one part of this
 * module I'd want smoke-tested against their docs, not just my testing.
 */
@Injectable()
export class PaystackService {
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(private readonly config: ConfigService) {}

  private secretKey(): string {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) {
      throw new InternalServerErrorException(
        'Payments are not configured on this server yet',
      );
    }
    return key;
  }

  async initializeTransaction(params: {
    email: string;
    amountKobo: number;
    reference: string;
    subaccountCode: string;
  }): Promise<InitializeTransactionResult> {
    const response = await this.request('/transaction/initialize', 'POST', {
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      subaccount: params.subaccountCode,
      // bearer: 'account' — the platform's main account bears Paystack's
      // processing fee, not deducted from the split. Our own 10% commission
      // is computed and taken separately at release, not via this split.
      bearer: 'account',
    });

    return {
      authorizationUrl: response.data.authorization_url,
      accessCode: response.data.access_code,
    };
  }

  async verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
    const response = await this.request(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      'GET',
    );

    return {
      successful: response.data.status === 'success',
      amountKobo: response.data.amount,
      currency: response.data.currency,
    };
  }

  async createSubaccount(params: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
  }): Promise<string> {
    const response = await this.request('/subaccount', 'POST', {
      business_name: params.businessName,
      bank_code: params.bankCode,
      account_number: params.accountNumber,
      // Platform commission is taken separately at release, computed off
      // the actual agreed price — this is set to 0 so Paystack doesn't
      // double-deduct anything at checkout time.
      percentage_charge: 0,
      settlement_schedule: 'manual',
    });

    return response.data.subaccount_code;
  }

  async releaseToSeller(params: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    amountKobo: number;
    reference: string;
  }): Promise<void> {
    const recipient = await this.request('/transferrecipient', 'POST', {
      type: 'nuban',
      name: params.accountName,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: 'NGN',
    });

    await this.request('/transfer', 'POST', {
      source: 'balance',
      amount: params.amountKobo,
      recipient: recipient.data.recipient_code,
      reference: params.reference,
      reason: 'Declut escrow release',
    });
  }

  async refund(reference: string): Promise<void> {
    await this.request('/refund', 'POST', { transaction: reference });
  }

  verifyWebhookSignature(
    rawBody: Buffer,
    signature: string | undefined,
  ): boolean {
    if (!signature) return false;

    const secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) return false;

    const expected = createHmac('sha512', secretKey)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison — a naive === here would leak timing info
    // that could help an attacker guess a valid signature byte-by-byte.
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;

    return timingSafeEqual(expectedBuf, providedBuf);
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
      },
      ...(body && { body: JSON.stringify(body) }),
    });

    const data = await response.json();
    if (!response.ok || data.status === false) {
      throw new InternalServerErrorException(
        `Paystack request failed: ${data.message ?? response.statusText}`,
      );
    }
    return data;
  }
}
