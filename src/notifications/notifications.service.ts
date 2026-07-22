import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceToken, DeviceTokenDocument, DevicePlatform } from './schemas/device-token.schema';
import { FcmService, PushNotificationPayload } from './fcm.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(DeviceToken.name) private deviceTokenModel: Model<DeviceTokenDocument>,
    private readonly fcmService: FcmService,
  ) {}

  async registerToken(
    userId: string,
    token: string,
    platform?: DevicePlatform,
  ): Promise<void> {
    await this.deviceTokenModel
      .updateOne(
        { token },
        { user: userId, token, platform },
        { upsert: true },
      )
      .exec();
  }

  async unregisterToken(userId: string, token: string): Promise<void> {
    await this.deviceTokenModel.deleteOne({ user: userId, token }).exec();
  }

  // Deliberately never throws — every caller of this (Transactions, Offers,
  // Reviews, KYC) is in the middle of a real business operation, and a push
  // notification failing (or FCM not being configured at all, which is the
  // case in this environment) must never roll that back or surface as an
  // API error to the end user.
  async notifyUser(userId: string, payload: PushNotificationPayload): Promise<void> {
    try {
      const deviceTokens = await this.deviceTokenModel.find({ user: userId }).exec();
      if (deviceTokens.length === 0) {
        return;
      }

      const { invalidTokens } = await this.fcmService.sendToTokens(
        deviceTokens.map((d) => d.token),
        payload,
      );

      if (invalidTokens.length > 0) {
        await this.deviceTokenModel.deleteMany({ token: { $in: invalidTokens } }).exec();
      }
    } catch (err) {
      this.logger.error(`notifyUser failed for user ${userId}`, err as Error);
    }
  }
}
