import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { Admin, AdminDocument } from '../../admin-auth/schemas/admin.schema';
import { NotificationsService } from '../notifications.service';
import { NotificationRecipientType } from '../schemas/notification.schema';
import { NotificationBroadcastStatus } from '../schemas/notification-broadcast.schema';
import { BROADCAST_QUEUE, BroadcastJobData } from './broadcast-queue.constants';

// Fans one content-published broadcast out to every User and Admin, streaming both collections via a lean Mongo cursor rather than loading them into memory — one long-running job, not sub-batched into parallel jobs; revisit with BullMQ's flow producer if recipient counts get large.
// drainDelay/stalledInterval raised to 30 min (defaults are 5s/30s) — this queue fires rarely, so on stock defaults nearly all its Redis traffic is idle re-polling, not real jobs. A new job still wakes the worker instantly (BullMQ unblocks on add, independent of this timer); this only slows how often the worker re-arms its "nothing to do" wait and re-scans for stalled jobs while idle.
@Processor(BROADCAST_QUEUE, { drainDelay: 1800, stalledInterval: 1_800_000 })
export class NotificationBroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationBroadcastProcessor.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<BroadcastJobData>): Promise<void> {
    const { broadcastId, title, body } = job.data;

    try {
      const userCursor = this.userModel
        .find({}, 'email name deviceTokens')
        .lean()
        .cursor();
      for await (const user of userCursor) {
        await this.notificationsService.notify({
          recipientType: NotificationRecipientType.USER,
          recipientId: user._id.toString(),
          type: 'content_updated',
          title,
          body,
          broadcastId,
          recipientInfo: {
            email: user.email,
            name: user.name,
            deviceTokens: user.deviceTokens,
          },
        });
      }

      const adminCursor = this.adminModel
        .find({}, 'email name')
        .lean()
        .cursor();
      for await (const admin of adminCursor) {
        await this.notificationsService.notify({
          recipientType: NotificationRecipientType.ADMIN,
          recipientId: admin._id.toString(),
          type: 'content_updated',
          title,
          body,
          broadcastId,
          recipientInfo: { email: admin.email, name: admin.name },
        });
      }

      await this.notificationsService.finalizeBroadcastStats(broadcastId);
    } catch (err) {
      this.logger.error(
        `Broadcast ${broadcastId} failed mid-fan-out`,
        err as Error,
      );
      await this.notificationsService.updateBroadcast(broadcastId, {
        status: NotificationBroadcastStatus.FAILED,
      });
      throw err;
    }
  }
}
