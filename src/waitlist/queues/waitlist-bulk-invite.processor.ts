import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WaitlistService } from '../waitlist.service';
import {
  WAITLIST_INVITE_QUEUE,
  WaitlistBulkInviteJobData,
} from './waitlist-invite-queue.constants';

// Per-recipient try/catch, unlike NotificationBroadcastProcessor's loop —
// WaitlistService.getInvitableEntry()/deliverInvite() can throw (missing
// entry, id/email mismatch, already joined, email-send failure), and one
// bad or failed recipient in a batch of hundreds must not abort the rest.
// drainDelay/stalledInterval raised to 30 min — same reasoning as
// NotificationBroadcastProcessor: this queue fires rarely, real jobs still
// wake the worker instantly, this only cuts idle-poll Redis commands.
@Processor(WAITLIST_INVITE_QUEUE, {
  drainDelay: 1800,
  stalledInterval: 1_800_000,
})
export class WaitlistBulkInviteProcessor extends WorkerHost {
  private readonly logger = new Logger(WaitlistBulkInviteProcessor.name);

  constructor(private readonly waitlistService: WaitlistService) {
    super();
  }

  async process(job: Job<WaitlistBulkInviteJobData>): Promise<void> {
    const { recipients, message, adminId } = job.data;

    for (const { id, email } of recipients) {
      try {
        const entry = await this.waitlistService.getInvitableEntry(id, email);
        await this.waitlistService.deliverInvite(entry, message, adminId);
      } catch (err) {
        this.logger.error(
          `Bulk invite failed for waitlist entry ${id}`,
          err as Error,
        );
      }
    }
  }
}
