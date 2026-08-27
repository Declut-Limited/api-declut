import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { FcmService, PushNotificationPayload } from './fcm.service';
import { NotificationsGateway } from './notifications.gateway';
import { Admin, AdminDocument } from '../admin-auth/schemas/admin.schema';
import {
  Notification,
  NotificationChannelStatus,
  NotificationDocument,
  NotificationRecipientType,
} from './schemas/notification.schema';
import {
  NotificationBroadcast,
  NotificationBroadcastChannel,
  NotificationBroadcastDocument,
  NotificationBroadcastStatus,
  NotificationBroadcastTrigger,
} from './schemas/notification-broadcast.schema';
import { ContentDocument } from '../content/schemas/content.schema';
import { NotificationType, channelsFor } from './notification-types';
import {
  BROADCAST_QUEUE,
  BroadcastJobData,
} from './queues/broadcast-queue.constants';

interface ChannelOutcome {
  status: NotificationChannelStatus;
  error?: string;
}

interface RecipientInfo {
  email?: string;
  name?: string;
  deviceTokens?: string[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly fcmService: FcmService,
    private readonly emailService: EmailService,
    private readonly gateway: NotificationsGateway,
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    @InjectModel(NotificationBroadcast.name)
    private broadcastModel: Model<NotificationBroadcastDocument>,
    @InjectQueue(BROADCAST_QUEUE)
    private broadcastQueue: Queue<BroadcastJobData>,
  ) {}

  async registerTokens(userId: string, tokens: string[]): Promise<void> {
    await this.usersService.addDeviceTokens(userId, tokens);
  }

  async unregisterToken(userId: string, token: string): Promise<void> {
    await this.usersService.removeDeviceToken(userId, token);
  }

  // Pre-existing push-only path, left untouched — Transactions/KYC/Reviews still call this for their existing event set; migrating those onto Notification is a later pass. Never throws.
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

  // Generalized path: save the Notification row first, then attempt whichever channels `type` uses (notification-types.ts), then patch in each channel's outcome. Never throws. `recipientInfo`, when passed, skips the User/Admin lookup — used by the bulk processor, which already has the doc from its own cursor.
  async notify(params: {
    recipientType: NotificationRecipientType;
    recipientId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, string>;
    broadcastId?: string;
    recipientInfo?: RecipientInfo;
  }): Promise<void> {
    const channels = channelsFor(params.type, params.recipientType);

    const doc = await this.notificationModel.create({
      recipientType: params.recipientType,
      recipient: new Types.ObjectId(params.recipientId),
      type: params.type,
      title: params.title,
      body: params.body,
      data: params.data,
      broadcast: params.broadcastId
        ? new Types.ObjectId(params.broadcastId)
        : undefined,
    });

    const channelUpdate: Record<string, ChannelOutcome> = {};

    if (channels.includes('push')) {
      channelUpdate.push = await this.attemptPush(params);
    }
    if (channels.includes('email')) {
      channelUpdate.email = await this.attemptEmail(params);
    }

    if (Object.keys(channelUpdate).length > 0) {
      try {
        await this.notificationModel.updateOne(
          { _id: doc._id },
          { $set: { channels: channelUpdate } },
        );
      } catch (err) {
        this.logger.error(
          `Failed to record channel outcomes for notification ${doc._id.toString()}`,
          err as Error,
        );
      }
    }

    if (params.recipientType === NotificationRecipientType.ADMIN) {
      this.gateway.emitToAdmin(params.recipientId, {
        id: doc._id.toString(),
        type: params.type,
        title: params.title,
        body: params.body,
        data: params.data,
        channels: channelUpdate,
        read: false,
        createdAt: doc.createdAt,
      });
    }
  }

  // GET /notifications and GET /admin/notifications both call this — same shape either way.
  async listForRecipient(
    recipientType: NotificationRecipientType,
    recipientId: string,
    page: number,
    limit: number,
  ): Promise<{
    results: NotificationDocument[];
    total: number;
    unreadCount: number;
    page: number;
    limit: number;
  }> {
    const filter = {
      recipientType,
      recipient: new Types.ObjectId(recipientId),
    };
    const [results, total, unreadCount] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.notificationModel.countDocuments(filter),
      this.notificationModel.countDocuments({ ...filter, read: false }),
    ]);
    return { results, total, unreadCount, page, limit };
  }

  // Scoped to the caller — same object-level ownership rule every mutating endpoint in this app follows.
  async markRead(
    recipientType: NotificationRecipientType,
    recipientId: string,
    notificationId: string,
  ): Promise<void> {
    await this.notificationModel.updateOne(
      {
        _id: notificationId,
        recipientType,
        recipient: new Types.ObjectId(recipientId),
      },
      { $set: { read: true, readAt: new Date() } },
    );
  }

  // Triggered from ContentService whenever a save results in status 'published'. Writes the NotificationBroadcast row synchronously, then queues the fan-out.
  async broadcastContentPublished(
    content: ContentDocument,
    actorAdminId: string,
  ): Promise<void> {
    const broadcast = await this.broadcastModel.create({
      title: content.title,
      trigger: NotificationBroadcastTrigger.CONTENT_PUBLISHED,
      recipientDescription: 'All users and admins',
      channel: NotificationBroadcastChannel.BOTH,
      status: NotificationBroadcastStatus.SENDING,
      startDate: new Date(),
      content: content._id,
      createdBy: new Types.ObjectId(actorAdminId),
    });

    // The Content document already saved successfully — a Redis outage here must not fail the caller's save, same posture as every other non-critical vendor call in this app.
    try {
      await this.broadcastQueue.add('fan-out', {
        broadcastId: broadcast._id.toString(),
        title: content.title,
        body: `"${content.title}" was just updated — check it out.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to enqueue broadcast ${broadcast._id.toString()}`,
        err as Error,
      );
      await this.updateBroadcast(broadcast._id.toString(), {
        status: NotificationBroadcastStatus.FAILED,
      });
    }
  }

  async listBroadcasts(
    page: number,
    limit: number,
    status?: NotificationBroadcastStatus,
  ): Promise<{
    results: NotificationBroadcastDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = status ? { status } : {};
    const [results, total] = await Promise.all([
      this.broadcastModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.broadcastModel.countDocuments(filter),
    ]);
    return { results, total, page, limit };
  }

  // Used only by NotificationBroadcastProcessor to update counts/status.
  updateBroadcast(
    broadcastId: string,
    update: Partial<
      Pick<
        NotificationBroadcast,
        'status' | 'sentAt' | 'recipientCount' | 'sentCount' | 'failedCount'
      >
    >,
  ): Promise<unknown> {
    return this.broadcastModel
      .updateOne({ _id: broadcastId }, { $set: update })
      .exec();
  }

  // Aggregates the fanned-out Notification rows for one broadcast into final counts, rather than hand-tallying during the fan-out loop.
  async finalizeBroadcastStats(broadcastId: string): Promise<void> {
    const recipientCount = await this.notificationModel.countDocuments({
      broadcast: new Types.ObjectId(broadcastId),
    });
    const sentCount = await this.notificationModel.countDocuments({
      broadcast: new Types.ObjectId(broadcastId),
      $or: [
        { 'channels.push.status': NotificationChannelStatus.SENT },
        { 'channels.email.status': NotificationChannelStatus.SENT },
      ],
    });
    await this.updateBroadcast(broadcastId, {
      status: NotificationBroadcastStatus.SENT,
      sentAt: new Date(),
      recipientCount,
      sentCount,
      failedCount: recipientCount - sentCount,
    });
  }

  // Force-drops an admin's live socket connection — the JWT access token itself stays valid until natural expiry (this app's access tokens are stateless, not blacklistable), so this doesn't revoke the token, it just stops the bell from staying live past logout.
  disconnectAdminSockets(adminId: string): void {
    this.gateway.disconnectAdmin(adminId);
  }

  private async attemptPush(params: {
    recipientId: string;
    title: string;
    body: string;
    data?: Record<string, string>;
    recipientInfo?: RecipientInfo;
  }): Promise<ChannelOutcome> {
    try {
      const tokens =
        params.recipientInfo?.deviceTokens ??
        (await this.usersService.findById(params.recipientId))?.deviceTokens ??
        [];
      if (tokens.length === 0) {
        return { status: NotificationChannelStatus.SKIPPED };
      }

      const { invalidTokens } = await this.fcmService.sendToTokens(tokens, {
        title: params.title,
        body: params.body,
        data: params.data,
      });
      if (invalidTokens.length > 0) {
        await this.usersService.removeDeviceTokens(invalidTokens);
      }
      return { status: NotificationChannelStatus.SENT };
    } catch (err) {
      this.logger.error('Push send failed', err as Error);
      return {
        status: NotificationChannelStatus.FAILED,
        error: (err as Error).message,
      };
    }
  }

  private async attemptEmail(params: {
    recipientType: NotificationRecipientType;
    recipientId: string;
    title: string;
    body: string;
    recipientInfo?: RecipientInfo;
  }): Promise<ChannelOutcome> {
    try {
      let email = params.recipientInfo?.email;
      let name = params.recipientInfo?.name;

      if (!email) {
        if (params.recipientType === NotificationRecipientType.USER) {
          const user = await this.usersService.findById(params.recipientId);
          email = user?.email;
          name = user?.name;
        } else {
          const admin = await this.adminModel
            .findById(params.recipientId)
            .exec();
          email = admin?.email;
          name = admin?.name;
        }
      }

      if (!email) {
        return { status: NotificationChannelStatus.SKIPPED };
      }

      await this.emailService.sendEmail({
        to: email,
        toName: name ?? '',
        subject: params.title,
        html: `<p>${params.body}</p>`,
      });
      return { status: NotificationChannelStatus.SENT };
    } catch (err) {
      this.logger.error('Notification email send failed', err as Error);
      return {
        status: NotificationChannelStatus.FAILED,
        error: (err as Error).message,
      };
    }
  }
}
