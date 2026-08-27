import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';
import {
  Waitlist,
  WaitlistDocument,
  WaitlistInterest,
  WaitlistInviteStatus,
  WaitlistStatus,
} from './schemas/waitlist.schema';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';
import { ListWaitlistDto } from './dto/list-waitlist.dto';
import { InviteWaitlistDto } from './dto/invite-waitlist.dto';
import { BulkInviteWaitlistDto } from './dto/bulk-invite-waitlist.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from '../email/email.service';
import { escapeRegex } from '../common/utils/regex.util';
import {
  WAITLIST_INVITE_QUEUE,
  WaitlistBulkInviteJobData,
} from './queues/waitlist-invite-queue.constants';

@Injectable()
export class WaitlistService {
  constructor(
    @InjectModel(Waitlist.name) private waitlistModel: Model<WaitlistDocument>,
    @InjectQueue(WAITLIST_INVITE_QUEUE)
    private inviteQueue: Queue<WaitlistBulkInviteJobData>,
    private readonly auditLogService: AuditLogService,
    private readonly emailService: EmailService,
  ) {}

  // Idempotent by design — a resubmission of an already-registered email is
  // a success, not a 409, since this is a public marketing form and a hard
  // error on double-submit is bad UX. Interest is left as originally
  // submitted, not overwritten by the resubmission.
  async join(dto: JoinWaitlistDto): Promise<void> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.waitlistModel.findOne({ email }).exec();
    if (existing) {
      return;
    }
    await this.waitlistModel.create({ email, interest: dto.interest });
  }

  list(dto: ListWaitlistDto): Promise<{
    results: WaitlistDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.queryList(dto);
  }

  // Backs "select all eligible for bulk invite" — status/inviteStatus are
  // pinned to the invitable combination regardless of what the caller
  // passes for those two fields; search/page/limit still pass through.
  listUninvited(dto: ListWaitlistDto): Promise<{
    results: WaitlistDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.queryList({
      ...dto,
      status: WaitlistStatus.WAITING,
      inviteStatus: WaitlistInviteStatus.NOT_SENT,
    });
  }

  private async queryList(dto: ListWaitlistDto): Promise<{
    results: WaitlistDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter: Record<string, unknown> = {};
    if (dto.status) filter.status = dto.status;
    if (dto.interest) filter.interest = dto.interest;
    if (dto.inviteStatus) filter.inviteStatus = dto.inviteStatus;
    if (dto.search) filter.email = new RegExp(escapeRegex(dto.search), 'i');

    const [results, total] = await Promise.all([
      this.waitlistModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.waitlistModel.countDocuments(filter),
    ]);

    return { results, total, page, limit };
  }

  async getInsights(): Promise<{
    waiting: number;
    invited: number;
    joined: number;
    buyerInterest: number;
    sellerInterest: number;
    bothBuyerAndSellerInterest: number;
  }> {
    const [waiting, invited, joined, total, interestRows] = await Promise.all([
      this.waitlistModel.countDocuments({ status: WaitlistStatus.WAITING }),
      this.waitlistModel.countDocuments({ status: WaitlistStatus.INVITED }),
      this.waitlistModel.countDocuments({ status: WaitlistStatus.JOINED }),
      this.waitlistModel.countDocuments({}),
      this.waitlistModel.aggregate<{ _id: WaitlistInterest; count: number }>([
        { $group: { _id: '$interest', count: { $sum: 1 } } },
      ]),
    ]);

    const interestCounts = new Map(interestRows.map((r) => [r._id, r.count]));
    const pct = (count: number) =>
      total > 0 ? Math.round((count / total) * 1000) / 10 : 0;

    return {
      waiting,
      invited,
      joined,
      buyerInterest: pct(interestCounts.get(WaitlistInterest.BUYING) ?? 0),
      sellerInterest: pct(interestCounts.get(WaitlistInterest.SELLING) ?? 0),
      bothBuyerAndSellerInterest: pct(
        interestCounts.get(WaitlistInterest.BOTH) ?? 0,
      ),
    };
  }

  async remove(id: string, adminId: string): Promise<void> {
    const entry = await this.waitlistModel.findById(id).exec();
    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }
    await entry.deleteOne();

    await this.auditLogService.record({
      entityType: 'waitlist',
      entityId: id,
      event: 'waitlist.removed',
      actor: adminId,
      oldState: entry.status,
    });
  }

  // Called from AuthService on every new-account creation (both signup
  // paths). The only place `status` ever becomes 'joined' — a matching
  // entry must have actually been invited (status=invited, inviteStatus
  // sent/delivered), not just be sitting at 'waiting', to count as joined
  // via an invite. Silent no-op if no such entry exists, which is the
  // common case (most signups were never on the waitlist at all).
  async markJoinedIfInvited(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const entry = await this.waitlistModel.findOneAndUpdate(
      {
        email: normalizedEmail,
        status: WaitlistStatus.INVITED,
        inviteStatus: {
          $in: [WaitlistInviteStatus.SENT, WaitlistInviteStatus.DELIVERED],
        },
      },
      { status: WaitlistStatus.JOINED },
    );
    if (!entry) {
      return;
    }

    await this.auditLogService.record({
      entityType: 'waitlist',
      entityId: entry._id.toString(),
      event: 'waitlist.joined',
      actor: 'system',
      oldState: entry.status,
      newState: WaitlistStatus.JOINED,
    });
  }

  // Shared object-level check for both the single and bulk invite paths.
  // Invite is a one-shot action, not a resend — anything already invited,
  // joined, or with an invite already sent/delivered is rejected outright.
  async getInvitableEntry(
    id: string,
    email: string,
  ): Promise<WaitlistDocument> {
    const entry = await this.waitlistModel.findById(id).exec();
    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }
    if (entry.email !== email.toLowerCase().trim()) {
      throw new BadRequestException('Email does not match this waitlist entry');
    }
    if (
      entry.status !== WaitlistStatus.WAITING ||
      entry.inviteStatus !== WaitlistInviteStatus.NOT_SENT
    ) {
      throw new BadRequestException(
        'This waitlist entry has already been invited or has joined',
      );
    }
    return entry;
  }

  // Send + record, shared by inviteSingle() and the bulk processor.
  async deliverInvite(
    entry: WaitlistDocument,
    message: string,
    adminId: string,
  ): Promise<void> {
    await this.emailService.sendWaitlistInviteEmail(entry.email, message);

    entry.status = WaitlistStatus.INVITED;
    entry.inviteStatus = WaitlistInviteStatus.SENT;
    await entry.save();

    await this.auditLogService.record({
      entityType: 'waitlist',
      entityId: entry._id.toString(),
      event: 'waitlist.invited',
      actor: adminId,
      newState: entry.status,
    });
  }

  async inviteSingle(
    id: string,
    dto: InviteWaitlistDto,
    adminId: string,
  ): Promise<void> {
    const entry = await this.getInvitableEntry(id, dto.email);
    await this.deliverInvite(entry, dto.message, adminId);
  }

  // Queued rather than sent inline — the whole point of the queue is to not
  // block the admin's request on N sequential email sends.
  async bulkInvite(
    dto: BulkInviteWaitlistDto,
    adminId: string,
  ): Promise<{ queued: number }> {
    await this.inviteQueue.add('bulk-invite', {
      recipients: dto.recipients,
      message: dto.message,
      adminId,
    });
    return { queued: dto.recipients.length };
  }
}
