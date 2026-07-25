import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { FcmService, PushNotificationPayload } from './fcm.service';
import { AdminNotificationsGateway } from './admin-notifications.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly fcmService: FcmService,
    private readonly adminGateway: AdminNotificationsGateway,
  ) {}

  async registerTokens(userId: string, tokens: string[]): Promise<void> {
    await this.usersService.addDeviceTokens(userId, tokens);
  }

  async unregisterToken(userId: string, token: string): Promise<void> {
    await this.usersService.removeDeviceToken(userId, token);
  }

  // Never throws — callers are mid-business-operation and a push failure
  // must never roll that back or surface as an API error.
  async notifyUser(
    userId: string,
    payload: PushNotificationPayload,
  ): Promise<void> {
    try {
      const user = await this.usersService.findById(userId);
      if (!user || user.deviceTokens.length === 0) {
        return;
      }

      const { invalidTokens } = await this.fcmService.sendToTokens(
        user.deviceTokens,
        payload,
      );

      if (invalidTokens.length > 0) {
        await this.usersService.removeDeviceTokens(invalidTokens);
      }
    } catch (err) {
      this.logger.error(`notifyUser failed for user ${userId}`, err as Error);
    }
  }

  // Admin-only live in-app channel — separate from notifyUser()'s FCM push.
  notifyAdmins(event: string, payload: Record<string, unknown>): void {
    try {
      this.adminGateway.broadcast(event, payload);
    } catch (err) {
      this.logger.error(`notifyAdmins failed for event ${event}`, err as Error);
    }
  }
}
