import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSendResult {
  successCount: number;
  invalidTokens: string[];
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Expo's documented cap per request.
const EXPO_CHUNK_SIZE = 100;
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[.+\]$/;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Sends push notifications via Expo's hosted Push API, not firebase-admin
 * directly — the mobile app is Expo-managed and registers Expo push tokens
 * (`ExponentPushToken[...]`), confirmed against a real stored token
 * 2026-09-27; firebase-admin's `getMessaging().send()` doesn't understand
 * that token format at all, which is why no push notification the app ever
 * sent could have reached a device regardless of Firebase credentials being
 * correct. Expo's own service is what actually relays to FCM/APNs from
 * here, using Expo's own project credentials, not ours — no Firebase
 * involvement for push anymore. firebase-admin/FirebaseAdminService stay in
 * this codebase for exactly one remaining job: verifying the Firebase ID
 * token behind Google sign-in (GoogleOAuthService) — untouched by this.
 * A push notification failing to send must never break the caller's actual
 * business operation (a payment released, a report filed, etc.), so this
 * swallows and logs errors instead of throwing.
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(private readonly config: ConfigService) {}

  async sendToTokens(
    tokens: string[],
    payload: PushNotificationPayload,
  ): Promise<PushSendResult> {
    if (tokens.length === 0) {
      return { successCount: 0, invalidTokens: [] };
    }

    // A token that isn't Expo-shaped can never be delivered by this
    // transport — reject it up front rather than spending an Expo API call
    // on it. Also catches any stale raw-FCM-format token left over from
    // before this switch.
    const invalidTokens: string[] = tokens.filter(
      (t) => !EXPO_TOKEN_RE.test(t),
    );
    const validTokens = tokens.filter((t) => EXPO_TOKEN_RE.test(t));
    if (validTokens.length === 0) {
      return { successCount: 0, invalidTokens };
    }

    const accessToken = this.config.get<string>('EXPO_ACCESS_TOKEN');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    let successCount = 0;

    for (let i = 0; i < validTokens.length; i += EXPO_CHUNK_SIZE) {
      const chunk = validTokens.slice(i, i + EXPO_CHUNK_SIZE);
      const messages = chunk.map((to) => ({
        to,
        title: payload.title,
        body: payload.body,
        data: payload.data,
      }));

      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(messages),
        });

        if (!response.ok) {
          this.logger.error(`Expo push send failed — HTTP ${response.status}`);
          continue;
        }

        const body = (await response.json()) as { data?: ExpoTicket[] };
        const tickets = body.data ?? [];

        tickets.forEach((ticket, idx) => {
          if (ticket.status === 'ok') {
            successCount += 1;
            return;
          }
          // "DeviceNotRegistered" is Expo's equivalent of FCM's
          // registration-token-not-registered/invalid-registration-token —
          // the token is permanently dead and safe to clear.
          if (ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(chunk[idx]);
          } else {
            this.logger.error(
              `Expo push rejected a message: ${ticket.message ?? 'unknown error'}`,
            );
          }
        });
      } catch (err) {
        this.logger.error('Expo push send failed', err as Error);
      }
    }

    return { successCount, invalidTokens };
  }
}
