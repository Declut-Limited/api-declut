import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  ReferralCampaign,
  ReferralCampaignDocument,
  ReferralCampaignStatus,
} from './schemas/referral-campaign.schema';
import { CreateReferralCampaignDto } from './dto/create-referral-campaign.dto';
import { UpdateReferralCampaignDto } from './dto/update-referral-campaign.dto';
import { ListReferralCampaignsDto } from './dto/list-referral-campaigns.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { buildDateRangeFilter } from '../common/utils/date-range.util';

// Only a campaign currently draft or scheduled can be edited — explicit
// instruction. published/ended are frozen.
const EDITABLE_STATUSES = [
  ReferralCampaignStatus.DRAFT,
  ReferralCampaignStatus.SCHEDULED,
];

const ADMIN_POPULATE_FIELDS = 'name email slug';

@Injectable()
export class ReferralsService {
  constructor(
    @InjectModel(ReferralCampaign.name)
    private referralCampaignModel: Model<ReferralCampaignDocument>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    dto: CreateReferralCampaignDto,
    adminId: string,
  ): Promise<ReferralCampaignDocument> {
    let campaign: ReferralCampaignDocument;
    try {
      campaign = await this.referralCampaignModel.create({
        name: dto.name,
        description: dto.description,
        internalCampaignCode: dto.internalCampaignCode,
        status: dto.status ?? ReferralCampaignStatus.DRAFT,
        startDate: dto.startDate,
        endDate: dto.endDate,
        rewardType: dto.rewardType,
        rewardAmount: dto.rewardAmount,
        maxCampaignBudget: dto.maxCampaignBudget,
        referralRequirement: dto.referralRequirement,
        qualificationWindow: dto.qualificationWindow,
        eligibility: dto.eligibility,
        validationRules: dto.validationRules,
        paymentMethod: dto.paymentMethod,
        paymentSchedule: dto.paymentSchedule,
        activationDate: dto.activationDate,
        activationTime: dto.activationTime,
        createdBy: adminId,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(
          'A campaign with this internalCampaignCode already exists',
        );
      }
      throw err;
    }

    await this.auditLogService.record({
      entityType: 'referral_campaign',
      entityId: campaign._id.toString(),
      event: 'referral_campaign.created',
      actor: adminId,
      newState: campaign.status,
    });

    return campaign.populate([
      { path: 'createdBy', select: ADMIN_POPULATE_FIELDS },
      { path: 'updatedBy', select: ADMIN_POPULATE_FIELDS },
    ]);
  }

  async list(dto: ListReferralCampaignsDto): Promise<{
    results: ReferralCampaignDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter: Record<string, unknown> = {
      ...(dto.status ? { status: dto.status } : {}),
      ...buildDateRangeFilter(dto),
    };

    const [results, total] = await Promise.all([
      this.referralCampaignModel
        .find(filter)
        .populate('createdBy', ADMIN_POPULATE_FIELDS)
        .populate('updatedBy', ADMIN_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.referralCampaignModel.countDocuments(filter),
    ]);

    return { results, total, page, limit };
  }

  async findById(id: string): Promise<ReferralCampaignDocument> {
    return this.findByIdOrThrow(id, true);
  }

  // Only draft/scheduled campaigns can be edited — explicit instruction.
  // updatedBy is appended to (never overwritten), matching the spec's
  // "array of admin ids" — a running history of every editor, not just the
  // most recent one.
  async update(
    id: string,
    dto: UpdateReferralCampaignDto,
    adminId: string,
  ): Promise<ReferralCampaignDocument> {
    const campaign = await this.findByIdOrThrow(id, false);
    if (!EDITABLE_STATUSES.includes(campaign.status)) {
      throw new BadRequestException(
        `Campaign is ${campaign.status} — only a draft or scheduled campaign can be edited`,
      );
    }
    const oldStatus = campaign.status;

    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.description !== undefined) campaign.description = dto.description;
    if (dto.internalCampaignCode !== undefined)
      campaign.internalCampaignCode = dto.internalCampaignCode;
    if (dto.status !== undefined) campaign.status = dto.status;
    if (dto.startDate !== undefined)
      campaign.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) campaign.endDate = new Date(dto.endDate);
    if (dto.rewardType !== undefined) campaign.rewardType = dto.rewardType;
    if (dto.rewardAmount !== undefined)
      campaign.rewardAmount = dto.rewardAmount;
    if (dto.maxCampaignBudget !== undefined)
      campaign.maxCampaignBudget = dto.maxCampaignBudget;
    if (dto.referralRequirement !== undefined)
      campaign.referralRequirement = dto.referralRequirement;
    if (dto.qualificationWindow !== undefined)
      campaign.qualificationWindow = dto.qualificationWindow;
    if (dto.eligibility !== undefined) campaign.eligibility = dto.eligibility;
    if (dto.validationRules !== undefined)
      campaign.validationRules = dto.validationRules;
    if (dto.paymentMethod !== undefined)
      campaign.paymentMethod = dto.paymentMethod;
    if (dto.paymentSchedule !== undefined)
      campaign.paymentSchedule = dto.paymentSchedule;
    if (dto.activationDate !== undefined)
      campaign.activationDate = new Date(dto.activationDate);
    if (dto.activationTime !== undefined)
      campaign.activationTime = dto.activationTime;

    campaign.updatedBy.push(new Types.ObjectId(adminId));

    try {
      await campaign.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(
          'A campaign with this internalCampaignCode already exists',
        );
      }
      throw err;
    }

    await this.auditLogService.record({
      entityType: 'referral_campaign',
      entityId: id,
      event: 'referral_campaign.updated',
      actor: adminId,
      oldState: oldStatus,
      newState: campaign.status,
    });

    return campaign.populate([
      { path: 'createdBy', select: ADMIN_POPULATE_FIELDS },
      { path: 'updatedBy', select: ADMIN_POPULATE_FIELDS },
    ]);
  }

  private async findByIdOrThrow(
    id: string,
    populate: boolean,
  ): Promise<ReferralCampaignDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Referral campaign not found');
    }
    const query = this.referralCampaignModel.findById(id);
    if (populate) {
      query
        .populate('createdBy', ADMIN_POPULATE_FIELDS)
        .populate('updatedBy', ADMIN_POPULATE_FIELDS);
    }
    const campaign = await query.exec();
    if (!campaign) {
      throw new NotFoundException('Referral campaign not found');
    }
    return campaign;
  }
}
