import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycCheckResult, KycProvider } from './kyc-provider.interface';

// Shape per a live sandbox call (2026-10-09):
// POST /v1/ng/identities/face-verification/nin with { idNumber, photoBase64 }
// (capital B; lowercase is rejected as "no photo provided"). One call returns
// the face-match verdict plus the NIN record's biodata under `nin`, so the
// name check needs no second request.
interface QoreIdFaceResponse {
  id?: number;
  summary?: {
    face_verification_check?: {
      match?: boolean;
      match_score?: number;
      matching_threshold?: number;
    };
  };
  status?: { state?: string; status?: string };
  nin?: {
    firstname?: string;
    lastname?: string;
  };
}

// A "bad input" answer from QoreID (unknown NIN, unreadable photo, etc.) —
// the user can fix it and retry, so it's recorded as a rejected attempt
// rather than surfaced as a server error.
class QoreIdRejection {
  constructor(readonly reason: string) {}
}

const DEFAULT_BASE_URL = 'https://api.qoreid.com';
// Refresh the cached access token this long before QoreID says it expires.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const FALLBACK_TOKEN_LIFETIME_S = 3600;

@Injectable()
export class QoreIdProvider implements KycProvider {
  readonly providerName = 'qoreid';
  private readonly logger = new Logger(QoreIdProvider.name);
  private accessToken?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService) {}

  async verifyIdentity(
    nin: string,
    selfieImageBase64: string,
    fullName: string,
  ): Promise<KycCheckResult> {
    const result = await this.call<QoreIdFaceResponse>(
      '/v1/ng/identities/face-verification/nin',
      { idNumber: nin, photoBase64: stripDataUrlPrefix(selfieImageBase64) },
    );
    if (result instanceof QoreIdRejection) {
      return this.rejected(result.reason);
    }

    const referenceId = this.referenceId(result.id);
    const check = result.summary?.face_verification_check;
    if (check?.match !== true || result.status?.status !== 'verified') {
      return {
        status: 'rejected',
        referenceId,
        failureReason:
          'Your selfie does not match the photo on your NIN record',
      };
    }

    const record = result.nin;
    if (!namesMatch(fullName, record?.firstname, record?.lastname)) {
      return {
        status: 'rejected',
        referenceId,
        failureReason:
          'The name on your account does not match the name on this NIN',
      };
    }

    return { status: 'verified', referenceId };
  }

  private async call<T>(
    path: string,
    body: Record<string, string>,
  ): Promise<T | QoreIdRejection> {
    const baseUrl = this.baseUrl();
    let response = await this.post(path, body, await this.getAccessToken());

    // Token revoked or expired early on QoreID's side — mint once and retry.
    if (response.status === 401) {
      this.accessToken = undefined;
      response = await this.post(path, body, await this.getAccessToken());
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const message = await readErrorMessage(response);
    if (response.status === 404) {
      return new QoreIdRejection('No record was found for this NIN');
    }
    if (response.status === 400 || response.status === 422) {
      return new QoreIdRejection(
        message ?? 'The details provided were invalid',
      );
    }

    this.logger.error(
      `QoreID ${path} failed: HTTP ${response.status} ${message ?? ''} (${baseUrl})`,
    );
    if (response.status === 401 || response.status === 403) {
      throw new InternalServerErrorException(
        'KYC provider rejected our credentials',
      );
    }
    throw new ServiceUnavailableException(
      'KYC verification is temporarily unavailable, please try again shortly',
    );
  }

  private post(
    path: string,
    body: Record<string, string>,
    token: string,
  ): Promise<Response> {
    return fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  // QoreID's REST APIs take a bearer token minted from the client
  // credentials (POST /token). Cached in memory until shortly before expiry.
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt) {
      return this.accessToken.value;
    }

    const clientId = this.config.get<string>('QOREID_CLIENT_ID');
    const secret = this.config.get<string>('QOREID_CLIENT_SECRET');
    if (!clientId || !secret) {
      throw new InternalServerErrorException(
        'KYC verification is not configured on this server yet',
      );
    }

    const response = await fetch(`${this.baseUrl()}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ clientId, secret }),
    });
    if (!response.ok) {
      this.logger.error(
        `QoreID token request failed: HTTP ${response.status} ${(await readErrorMessage(response)) ?? ''}`,
      );
      throw new InternalServerErrorException(
        'KYC provider rejected our credentials',
      );
    }

    const data = (await response.json()) as {
      accessToken?: string;
      expiresIn?: number | string;
    };
    if (!data.accessToken) {
      this.logger.error('QoreID token response had no accessToken');
      throw new ServiceUnavailableException(
        'KYC verification is temporarily unavailable, please try again shortly',
      );
    }
    const lifetimeMs = parseExpiresInSeconds(data.expiresIn) * 1000;
    this.accessToken = {
      value: data.accessToken,
      expiresAt: Date.now() + Math.max(lifetimeMs - TOKEN_EXPIRY_MARGIN_MS, 0),
    };
    return data.accessToken;
  }

  private baseUrl(): string {
    return (
      this.config.get<string>('QOREID_BASE_URL') || DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
  }

  private referenceId(id?: number): string {
    return id !== undefined ? `QOREID-${id}` : `QOREID-UNKNOWN-${Date.now()}`;
  }

  private rejected(reason: string): KycCheckResult {
    return {
      status: 'rejected',
      referenceId: this.referenceId(),
      failureReason: reason,
    };
  }
}

// QoreID documents expiresIn as "7200 secs" — accept that, a bare number, or
// a numeric string. Anything unreadable falls back to a conservative hour
// rather than NaN (which would make every request mint a new token).
function parseExpiresInSeconds(value: number | string | undefined): number {
  const seconds =
    typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds
    : FALLBACK_TOKEN_LIFETIME_S;
}

// User.name is one free-text field, so instead of splitting it into
// first/last we require every word of the NIN record's first and last name
// to appear somewhere in it — case/accent-insensitive and order-free
// (people often write their surname first). Middle names on either side are
// ignored. A record missing either name can't be confirmed, so it fails.
function namesMatch(
  fullName: string,
  recordFirstname?: string,
  recordLastname?: string,
): boolean {
  const first = nameWords(recordFirstname);
  const last = nameWords(recordLastname);
  if (first.length === 0 || last.length === 0) {
    return false;
  }
  const accountWords = new Set(nameWords(fullName));
  return [...first, ...last].every((word) => accountWords.has(word));
}

function nameWords(name?: string): string[] {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

// Mobile clients often send `data:image/jpeg;base64,...` — QoreID wants the
// raw base64 only.
function stripDataUrlPrefix(image: string): string {
  return image.replace(/^data:[^;]+;base64,/, '');
}

async function readErrorMessage(
  response: Response,
): Promise<string | undefined> {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    return Array.isArray(data.message) ? data.message.join(', ') : data.message;
  } catch {
    return undefined;
  }
}
