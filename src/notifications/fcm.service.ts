import { Injectable, Logger } from '@nestjs/common';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import { FirebaseAdminService } from '../firebase-admin/firebase-admin.service';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSendResult {
  successCount: number;
  invalidTokens: string[];
}

/**
 * One of two consumers of firebase-admin in this codebase — the other is
 * GoogleOAuthService, which verifies the Firebase ID token behind Google
 * sign-in (see CLAUDE.md's Auth Architecture section; Firebase is back in
 * Auth as of 2026-09-10). Both share the same lazily-initialized app via
 * FirebaseAdminService. This service's own job is FCM push notifications,
 * per v1 scope, with one difference from the Google-auth path: a push
 * notification failing to send is never allowed to break the caller's
 * actual business operation (a payment released, an offer accepted, etc.),
 * so this swallows and logs errors instead of throwing —
 * NotificationsService.notifyUser() is designed to never throw.
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(private readonly firebaseAdmin: FirebaseAdminService) {}

  async sendToTokens(
    tokens: string[],
    payload: PushNotificationPayload,
  ): Promise<PushSendResult> {
    if (tokens.length === 0) {
      return { successCount: 0, invalidTokens: [] };
    }

    const app = this.firebaseAdmin.getApp();
    if (!app) {
      this.logger.warn('FCM not configured — skipping push notification');
      return { successCount: 0, invalidTokens: [] };
    }

    const message: MulticastMessage = {
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    };

    try {
      const response = await getMessaging(app).sendEachForMulticast(message);
      const invalidTokens: string[] = [];
      response.responses.forEach((r, i) => {
        if (
          !r.success &&
          (r.error?.code === 'messaging/registration-token-not-registered' ||
            r.error?.code === 'messaging/invalid-registration-token')
        ) {
          invalidTokens.push(tokens[i]);
        }
      });
      return { successCount: response.successCount, invalidTokens };
    } catch (err) {
      this.logger.error('FCM send failed', err as Error);
      return { successCount: 0, invalidTokens: [] };
    }
  }
}
