import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  Campaign,
  CampaignChannel,
  CampaignDocument,
  CampaignStatus,
} from './schemas/campaign.schema';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';
import { AUTOMATION_RULES, AutomationRule } from './automation-rules';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class NotificationCampaignsService {
  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    adminId: string,
    dto: CreateCampaignDto,
  ): Promise<CampaignDocument> {
    const campaign = await this.campaignModel.create({
      title: dto.title,
      message: dto.message,
      channel: dto.channel,
      createdBy: adminId,
    });

    await this.auditLogService.record({
      entityType: 'campaign',
      entityId: campaign._id.toString(),
      event: 'campaign.created',
      actor: adminId,
      newState: campaign.status,
    });

    return campaign;
  }

  async list(dto: ListCampaignsDto): Promise<{
    results: CampaignDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter = dto.status ? { status: dto.status } : {};

    const [results, total] = await Promise.all([
      this.campaignModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.campaignModel.countDocuments(filter),
    ]);

    return { results, total, page, limit };
  }

  async findById(id: string): Promise<CampaignDocument> {
    return this.findByIdOrThrow(id);
  }

  async update(
    id: string,
    adminId: string,
    dto: UpdateCampaignDto,
  ): Promise<CampaignDocument> {
    const campaign = await this.findByIdOrThrow(id);
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('A sent campaign can no longer be edited');
    }
    if (dto.title !== undefined) campaign.title = dto.title;
    if (dto.message !== undefined) campaign.message = dto.message;
    await campaign.save();

    await this.auditLogService.record({
      entityType: 'campaign',
      entityId: id,
      event: 'campaign.updated',
      actor: adminId,
    });

    return campaign;
  }

  async remove(id: string, adminId: string): Promise<void> {
    const campaign = await this.findByIdOrThrow(id);
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('A sent campaign can no longer be deleted');
    }
    await campaign.deleteOne();

    await this.auditLogService.record({
      entityType: 'campaign',
      entityId: id,
      event: 'campaign.deleted',
      actor: adminId,
    });
  }

  // Reuses the existing single-recipient delivery paths
  // (NotificationsService.notifyUser / EmailService.sendEmail) in a loop —
  // a management layer over what already exists, not a new bulk-delivery
  // mechanism. Judgment call, flagged: this sends synchronously within the
  // request and isn't queued, which is fine at this app's current user
  // scale but wouldn't hold up at a much larger one — same caveat already
  // noted for the federated admin Users list.
  async send(id: string, adminId: string): Promise<CampaignDocument> {
    const campaign = await this.findByIdOrThrow(id);
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Campaign has already been sent');
    }

    const users = await this.usersService.adminSearchUsers({});

    if (campaign.channel === CampaignChannel.PUSH) {
      await Promise.all(
        users.map((user) =>
          this.notificationsService.notifyUser(user._id.toString(), {
            title: campaign.title,
            body: campaign.message,
            data: { type: 'campaign', campaignId: id },
          }),
        ),
      );
    } else {
      await Promise.all(
        users.map((user) =>
          this.emailService
            .sendEmail({
              to: user.email,
              toName: user.name,
              subject: campaign.title,
              html: `<p>${escapeHtml(campaign.message).replace(/\n/g, '<br>')}</p>`,
            })
            // Same never-let-one-failure-break-the-batch posture as
            // NotificationsService.notifyUser() — a bad email address
            // shouldn't abort the rest of the campaign.
            .catch(() => undefined),
        ),
      );
    }

    campaign.status = CampaignStatus.SENT;
    campaign.sentAt = new Date();
    campaign.recipientCount = users.length;
    await campaign.save();

    await this.auditLogService.record({
      entityType: 'campaign',
      entityId: id,
      event: 'campaign.sent',
      actor: adminId,
      oldState: CampaignStatus.DRAFT,
      newState: campaign.status,
      metadata: { recipientCount: users.length, channel: campaign.channel },
    });

    return campaign;
  }

  getAutomationRules(): AutomationRule[] {
    return AUTOMATION_RULES;
  }

  private async findByIdOrThrow(id: string): Promise<CampaignDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Campaign not found');
    }
    const campaign = await this.campaignModel.findById(id);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }
}

// Minimal escaping — the admin-composed message gets interpolated into an
// HTML email body, same helper already used in AdminService.emailSeller().
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
