import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types, isValidObjectId } from 'mongoose';
import { createHash } from 'crypto';
import {
  ReferralCampaign,
  ReferralCampaignDocument,
  ReferralCampaignStatus,
  EligibleUsers,
  ReferredTaskType,
  ReferralRequirement,
} from './schemas/referral-campaign.schema';
import {
  Participant,
  ParticipantDocument,
  ParticipantStatus,
} from './schemas/participant.schema';
import { Referral, ReferralDocument } from './schemas/referral.schema';
import { Reward, RewardDocument, RewardStatus } from './schemas/reward.schema';
import { CreateReferralCampaignDto } from './dto/create-referral-campaign.dto';
import { UpdateReferralCampaignDto } from './dto/update-referral-campaign.dto';
import { ListReferralCampaignsDto } from './dto/list-referral-campaigns.dto';
import { ReferralAnalyticsPeriod } from './dto/referral-analytics.dto';
import { ListReferralParticipantsDto } from './dto/list-referral-participants.dto';
import { ReferralParticipantDetailDto } from './dto/referral-participant-detail.dto';
import { ListReferralRewardsDto } from './dto/list-referral-rewards.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { describeEvent } from '../audit-log/event-labels';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { escapeRegex } from '../common/utils/regex.util';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Transaction,
  TransactionDocument,
} from '../transactions/schemas/transaction.schema';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CounterService } from '../common/counter/counter.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationRecipientType } from '../notifications/schemas/notification.schema';
import { toCsv } from '../common/utils/csv.util';

// Computed per-request against the calling user, never stored — see
// computeEligibilityStatus() below.
enum EligibilityStatus {
  ELIGIBLE = 'eligible',
  NOT_ELIGIBLE = 'not_eligible',
}

// Only a campaign currently draft or scheduled can be edited — explicit
// instruction. published/ended are frozen.
const EDITABLE_STATUSES = [
  ReferralCampaignStatus.DRAFT,
  ReferralCampaignStatus.SCHEDULED,
];

// A campaign only accepts new (or returning) participants while it's
// actually live — not before it publishes/activates, not after it ends.
const JOINABLE_STATUSES = [
  ReferralCampaignStatus.PUBLISHED,
  ReferralCampaignStatus.SCHEDULED,
];

// A participant already in one of these is mid-participation — join() must
// not be called again until they've left (or the campaign has otherwise
// moved them out of an active state).
const ACTIVE_PARTICIPANT_STATUSES = [
  ParticipantStatus.IN_PROGRESS,
  ParticipantStatus.QUALIFIED,
  ParticipantStatus.PAID,
];

const ADMIN_POPULATE_FIELDS = 'name email slug';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NEW_USER_WINDOW_DAYS = 30;

// Shapes of the aggregation pipeline rows built in listParticipantsAdmin()/
// listRewardsAdmin() below — an explicit interface (not Record<string,
// any>) so the row-shaping methods stay type-safe, same convention
// EscrowService's own shapeEscrowRow() uses for its populated fields.
interface AdminParticipantAggregateRow {
  _id: Types.ObjectId;
  slug?: string;
  status: ParticipantStatus;
  joinedAt: Date;
  referralCode: string;
  progress: { amountOfReferrals: number; amountOfCompletedTransaction: number };
  userDoc?: { _id: Types.ObjectId; name?: string; email?: string } | null;
  campaignDoc?: {
    _id: Types.ObjectId;
    name: string;
    rewardAmount: number;
    endDate: Date;
    qualificationWindow?: number;
    referralRequirement: { referralAmount: number };
  } | null;
  referredUsersCount: number;
  qualifiedCount: number;
}

interface AdminRewardAggregateRow {
  _id: Types.ObjectId;
  slug?: string;
  status: RewardStatus;
  amountPaid: number;
  createdAt: Date;
  userDoc?: { _id: Types.ObjectId; name?: string; email?: string } | null;
  campaignDoc?: {
    _id: Types.ObjectId;
    name: string;
    rewardAmount: number;
    paymentSchedule: string;
  } | null;
  referralDoc?: { qualifiedAt?: Date | null } | null;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

@Injectable()
export class ReferralsService {
  constructor(
    @InjectModel(ReferralCampaign.name)
    private referralCampaignModel: Model<ReferralCampaignDocument>,
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
    @InjectModel(Referral.name)
    private referralModel: Model<ReferralDocument>,
    @InjectModel(Reward.name)
    private rewardModel: Model<RewardDocument>,
    // Direct schema registration (not a UsersModule import) — avoids ever
    // needing to worry about a cycle, same pattern TrustScoreModule/
    // CategoriesService use for this exact kind of lightweight cross-module
    // field read (here: a user's name + signup date).
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    // Read-only — backs the participant detail's "referred users' own
    // transactions" sub-table (see getParticipantDetailAdmin() below).
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    private readonly auditLogService: AuditLogService,
    private readonly notificationsService: NotificationsService,
    private readonly counterService: CounterService,
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

  // Trimmed to exactly what the campaign-list table needs (name, reward,
  // date range, requirement, participant/qualified/paid counts, status,
  // creator) — explicit instruction ("reduce the campaign list data to just
  // what the table needs"). The full document (every config field) is only
  // ever returned by findById() below, the detail view.
  async list(dto: ListReferralCampaignsDto): Promise<{
    results: Record<string, unknown>[];
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

    const [campaigns, total] = await Promise.all([
      this.referralCampaignModel
        .find(filter)
        .populate('createdBy', ADMIN_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.referralCampaignModel.countDocuments(filter),
    ]);

    const results = await Promise.all(
      campaigns.map((campaign) => this.shapeAdminCampaignRow(campaign)),
    );

    return { results, total, page, limit };
  }

  // Unpaginated CSV of the same filtered set — same convention every other
  // admin export in this app follows. Carries a few extra columns beyond
  // the trimmed list shape (internalCampaignCode, paymentMethod/schedule,
  // createdAt) since a CSV export isn't bound by the table's own column
  // budget.
  async exportCampaignsCsv(dto: ListReferralCampaignsDto): Promise<string> {
    const filter: Record<string, unknown> = {
      ...(dto.status ? { status: dto.status } : {}),
      ...buildDateRangeFilter(dto),
    };
    const campaigns = await this.referralCampaignModel
      .find(filter)
      .populate('createdBy', ADMIN_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .exec();

    const rows = await Promise.all(
      campaigns.map(async (campaign) => {
        const counts = await this.computeCampaignCounts(campaign._id);
        const createdBy = campaign.createdBy as unknown as
          { name?: string } | undefined;
        return {
          _id: campaign._id.toString(),
          name: campaign.name,
          internalCampaignCode: campaign.internalCampaignCode,
          status: this.describeCampaignStatus(campaign.status),
          reward: campaign.rewardAmount,
          from: campaign.startDate ?? '',
          to: campaign.endDate,
          requirement: this.describeRequirement(campaign.referralRequirement),
          ...counts,
          paymentMethod: campaign.paymentMethod,
          paymentSchedule: campaign.paymentSchedule,
          createdBy: createdBy?.name ?? '',
          createdAt: campaign.createdAt,
        };
      }),
    );

    return toCsv(rows, [
      '_id',
      'name',
      'internalCampaignCode',
      'status',
      'reward',
      'from',
      'to',
      'requirement',
      'participants',
      'qualified',
      'paid',
      'paymentMethod',
      'paymentSchedule',
      'createdBy',
      'createdAt',
    ]);
  }

  private async computeCampaignCounts(
    campaignId: Types.ObjectId,
  ): Promise<{ participants: number; qualified: number; paid: number }> {
    const [participants, qualified, paid] = await Promise.all([
      this.participantModel.countDocuments({ campaign: campaignId }),
      this.participantModel.countDocuments({
        campaign: campaignId,
        status: ParticipantStatus.QUALIFIED,
      }),
      this.participantModel.countDocuments({
        campaign: campaignId,
        status: ParticipantStatus.PAID,
      }),
    ]);
    return { participants, qualified, paid };
  }

  private async shapeAdminCampaignRow(
    campaign: ReferralCampaignDocument,
  ): Promise<Record<string, unknown>> {
    const counts = await this.computeCampaignCounts(campaign._id);
    const createdBy = campaign.createdBy as unknown as
      { name?: string } | undefined;
    return {
      _id: campaign._id.toString(),
      name: campaign.name,
      reward: campaign.rewardAmount,
      from: campaign.startDate ?? null,
      to: campaign.endDate,
      requirement: this.describeRequirement(campaign.referralRequirement),
      ...counts,
      status: this.describeCampaignStatus(campaign.status),
      createdBy: createdBy?.name ?? null,
    };
  }

  // e.g. "2 successful referrals" (both task types enabled), "3 completed
  // sales" (complete_sale only), "2 completed transactions"
  // (complete_transaction only) — matches the design's Requirement column.
  private describeRequirement(requirement: ReferralRequirement): string {
    const n = requirement.referralAmount;
    const hasSale = requirement.eachReferredTask.includes(
      ReferredTaskType.COMPLETE_SALE,
    );
    const hasTransaction = requirement.eachReferredTask.includes(
      ReferredTaskType.COMPLETE_TRANSACTION,
    );
    const noun =
      hasSale && hasTransaction
        ? 'successful referral'
        : hasSale
          ? 'completed sale'
          : 'completed transaction';
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
  }

  // published -> "Active" — matches the design's Status column wording.
  private describeCampaignStatus(status: ReferralCampaignStatus): string {
    switch (status) {
      case ReferralCampaignStatus.PUBLISHED:
        return 'Active';
      case ReferralCampaignStatus.SCHEDULED:
        return 'Scheduled';
      case ReferralCampaignStatus.ENDED:
        return 'Ended';
      case ReferralCampaignStatus.ARCHIVED:
        return 'Archived';
      case ReferralCampaignStatus.DRAFT:
      default:
        return 'Draft';
    }
  }

  // Explicit instruction: "mongodb just attaches a unique id to it but the
  // data remains the same." Every field is copied verbatim EXCEPT
  // internalCampaignCode, which has a unique index and can't literally
  // duplicate — suffixed deterministically (-COPY, then -COPY-2, ... on a
  // repeat duplicate of the same campaign) rather than left to a random
  // string, same "no collision-check/retry loop needed at this app's scale"
  // reasoning Participant.referralCode's own doc comment already uses.
  // Judgment call, flagged: status is copied as-is (not reset to draft) —
  // the literal ask was "the data remains the same," not a request to
  // reset workflow state.
  async duplicate(
    id: string,
    adminId: string,
  ): Promise<ReferralCampaignDocument> {
    const original = await this.findByIdOrThrow(id, false);
    const newCode = await this.resolveDuplicateCode(
      original.internalCampaignCode,
    );

    const copy = await this.referralCampaignModel.create({
      name: original.name,
      description: original.description,
      internalCampaignCode: newCode,
      status: original.status,
      startDate: original.startDate,
      endDate: original.endDate,
      rewardType: original.rewardType,
      rewardAmount: original.rewardAmount,
      maxCampaignBudget: original.maxCampaignBudget,
      referralRequirement: original.referralRequirement,
      qualificationWindow: original.qualificationWindow,
      eligibility: original.eligibility,
      validationRules: original.validationRules,
      paymentMethod: original.paymentMethod,
      paymentSchedule: original.paymentSchedule,
      activationDate: original.activationDate,
      activationTime: original.activationTime,
      createdBy: adminId,
    });

    await this.auditLogService.record({
      entityType: 'referral_campaign',
      entityId: copy._id.toString(),
      event: 'referral_campaign.duplicated',
      actor: adminId,
      metadata: { duplicatedFrom: original._id.toString() },
      newState: copy.status,
    });

    return copy.populate([
      { path: 'createdBy', select: ADMIN_POPULATE_FIELDS },
      { path: 'updatedBy', select: ADMIN_POPULATE_FIELDS },
    ]);
  }

  private async resolveDuplicateCode(originalCode: string): Promise<string> {
    let candidate = `${originalCode}-COPY`;
    let suffix = 2;
    while (
      await this.referralCampaignModel.exists({
        internalCampaignCode: candidate,
      })
    ) {
      candidate = `${originalCode}-COPY-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  // Soft delete — sets status to ARCHIVED, never a real Mongo delete. Only
  // guard: can't archive an already-archived campaign. Every other status
  // (draft/published/scheduled/ended) can be archived — explicit instruction
  // gave no narrower starting-status restriction.
  async archive(
    id: string,
    adminId: string,
  ): Promise<ReferralCampaignDocument> {
    const campaign = await this.findByIdOrThrow(id, false);
    if (campaign.status === ReferralCampaignStatus.ARCHIVED) {
      throw new BadRequestException('Campaign is already archived');
    }
    const oldStatus = campaign.status;
    campaign.status = ReferralCampaignStatus.ARCHIVED;
    await campaign.save();

    await this.auditLogService.record({
      entityType: 'referral_campaign',
      entityId: id,
      event: 'referral_campaign.archived',
      actor: adminId,
      oldState: oldStatus,
      newState: campaign.status,
    });

    return campaign.populate([
      { path: 'createdBy', select: ADMIN_POPULATE_FIELDS },
      { path: 'updatedBy', select: ADMIN_POPULATE_FIELDS },
    ]);
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

  // Admin dashboard — 5 insights, all scoped to one shared period window
  // (mirrors FeedbackService.getAnalytics()'s thisMonth/lastMonth/
  // last3Months/thisYear/lastYear/custom shape, per explicit instruction).
  // Every count below is scoped to that same window via each collection's
  // own createdAt — judgment call, flagged: "period" wasn't specified per
  // insight, so each one is read as "created within the period" (a campaign
  // published, a participant joined, a referral made, a reward recorded),
  // not some other date on the document (there's no publishedAt/paidAt
  // field on any of these anyway).
  async getAnalytics(
    period: ReferralAnalyticsPeriod = 'thisMonth',
    startDate?: string,
    endDate?: string,
  ): Promise<{
    period: ReferralAnalyticsPeriod;
    since: Date;
    until: Date;
    insights: {
      activeCampaigns: number;
      participants: number;
      successfulReferrals: number;
      rewardPaid: number;
      conversionRate: string;
    };
  }> {
    const { since, until } = ReferralsService.resolvePeriodRange(
      period,
      startDate,
      endDate,
    );
    const periodFilter = { createdAt: { $gte: since, $lt: until } };

    const [
      activeCampaigns,
      inProgressUserIds,
      qualifiedOrPaidParticipantIds,
      paidParticipantIds,
      totalReferrals,
    ] = await Promise.all([
      this.referralCampaignModel.countDocuments({
        status: ReferralCampaignStatus.PUBLISHED,
        ...periodFilter,
      }),
      // Distinct by user, not a raw Participant document count — the same
      // user can hold a separate Participant row per campaign they've
      // joined, and explicit instruction is that this insight counts each
      // person once regardless of how many participation rows they have.
      this.participantModel.distinct('user', {
        status: ParticipantStatus.IN_PROGRESS,
        ...periodFilter,
      }),
      this.participantModel.distinct('_id', {
        status: { $in: [ParticipantStatus.QUALIFIED, ParticipantStatus.PAID] },
      }),
      this.participantModel.distinct('_id', {
        status: ParticipantStatus.PAID,
      }),
      this.referralModel.countDocuments(periodFilter),
    ]);
    const participants = inProgressUserIds.length;

    const [successfulReferrals, rewardPaid] = await Promise.all([
      // hasCompletedChallenge true AND the referring participant is
      // currently qualified or paid.
      this.referralModel.countDocuments({
        hasCompletedChallenge: true,
        referrer: { $in: qualifiedOrPaidParticipantIds },
        ...periodFilter,
      }),
      // Reward status paid AND the participant it's owed to is also paid.
      this.rewardModel.countDocuments({
        status: RewardStatus.PAID,
        participant: { $in: paidParticipantIds },
        ...periodFilter,
      }),
    ]);

    // Judgment call, flagged (explicitly left open by the request): read as
    // the referral funnel's own conversion — of every referral made in the
    // period, what share actually succeeded. Formatted as a percentage
    // string, matching this app's existing percentage-field convention
    // (Waitlist's buyerInterest, Feedback's filterByStatus.percentage).
    const conversionRate =
      totalReferrals === 0
        ? 0
        : Math.round((successfulReferrals / totalReferrals) * 1000) / 10;

    return {
      period,
      since,
      until,
      insights: {
        activeCampaigns,
        participants,
        successfulReferrals,
        rewardPaid,
        conversionRate: `${conversionRate}%`,
      },
    };
  }

  // Kept as its own local implementation rather than a shared util — same
  // "no prior-period comparison needed, adds lastYear" reasoning
  // FeedbackService.resolvePeriodRange() already documents for itself.
  private static resolvePeriodRange(
    period: ReferralAnalyticsPeriod,
    startDate?: string,
    endDate?: string,
  ): { since: Date; until: Date } {
    const now = new Date();
    switch (period) {
      case 'lastMonth': {
        const since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const until = new Date(now.getFullYear(), now.getMonth(), 1);
        return { since, until };
      }
      case 'last3Months': {
        const since = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        return { since, until: now };
      }
      case 'thisYear': {
        const since = new Date(now.getFullYear(), 0, 1);
        return { since, until: now };
      }
      case 'lastYear': {
        const since = new Date(now.getFullYear() - 1, 0, 1);
        const until = new Date(now.getFullYear(), 0, 1);
        return { since, until };
      }
      case 'custom': {
        const since = new Date(startDate!);
        const until = new Date(
          new Date(endDate!).getTime() + 24 * 60 * 60 * 1000,
        );
        return { since, until };
      }
      case 'thisMonth':
      default: {
        const since = new Date(now.getFullYear(), now.getMonth(), 1);
        return { since, until: now };
      }
    }
  }

  // Admin dashboard — 4 more sections beyond getAnalytics() above, all
  // scoped to one shared calendar-year filter (default: the current year).
  // Judgment call, flagged: only rewardSpent's chart was explicitly required
  // to be year-scoped — the other 3 sections are scoped to the same year
  // for consistency with how getAnalytics() itself scopes every insight to
  // one shared window, not because each was individually asked to be.
  async getDashboard(
    year?: number,
    allTime?: boolean,
  ): Promise<{
    year: number;
    rewardSpent: {
      chart: { month: string; amountSpent: number }[];
      bestMonth: string | null;
      totalSpent: number;
    };
    campaignPerformance: Record<string, unknown>[];
    topReferrals: Record<string, unknown>[];
    qualificationStatus: Record<string, number>;
  }> {
    const targetYear = year ?? new Date().getFullYear();
    const since = new Date(targetYear, 0, 1);
    const until = new Date(targetYear + 1, 0, 1);
    // rewardSpent's 12-month chart always needs one specific year regardless
    // of allTime — a Jan-Dec chart has no sensible "all time" reading. The
    // other 3 sections widen to every document ever when allTime is true —
    // explicit instruction ("this should really be year scoped, they can be
    // all time").
    const scopeFilter = allTime
      ? {}
      : { createdAt: { $gte: since, $lt: until } };

    const [
      rewardSpent,
      campaignPerformance,
      topReferrals,
      qualificationStatus,
    ] = await Promise.all([
      this.computeRewardSpent(since, until),
      this.computeCampaignPerformance(scopeFilter),
      this.computeTopReferrals(scopeFilter),
      this.computeQualificationStatus(scopeFilter),
    ]);

    return {
      year: targetYear,
      rewardSpent,
      campaignPerformance,
      topReferrals,
      qualificationStatus,
    };
  }

  // Chart is always Jan-Dec of the target year, zero-filled — same
  // always-12-buckets convention as revenue-trends. No dedicated paidAt
  // field exists on Reward, so this buckets by createdAt (same proxy
  // reasoning revenue-trends already documents for itself). bestMonth reads
  // as the month with the most *recipients* paid, not the highest amount —
  // a deliberately different, complementary metric to the money chart and
  // totalSpent right next to it.
  private async computeRewardSpent(
    since: Date,
    until: Date,
  ): Promise<{
    chart: { month: string; amountSpent: number }[];
    bestMonth: string | null;
    totalSpent: number;
  }> {
    const paidRewards = await this.rewardModel
      .find({
        status: RewardStatus.PAID,
        createdAt: { $gte: since, $lt: until },
      })
      .select('amountPaid createdAt')
      .exec();

    const monthly = MONTH_NAMES.map((month) => ({
      month,
      amountSpent: 0,
      count: 0,
    }));

    for (const reward of paidRewards) {
      const bucket = monthly[reward.createdAt.getMonth()];
      bucket.amountSpent += reward.amountPaid;
      bucket.count += 1;
    }

    const totalSpent = monthly.reduce((sum, m) => sum + m.amountSpent, 0);

    const bestIndex = monthly.reduce(
      (best, m, i) => (m.count > monthly[best].count ? i : best),
      0,
    );
    const bestMonth =
      monthly[bestIndex].count > 0
        ? `${monthly[bestIndex].month} - ${monthly[bestIndex].count} users`
        : null;

    return {
      chart: monthly.map(({ month, amountSpent }) => ({ month, amountSpent })),
      bestMonth,
      totalSpent,
    };
  }

  // The 3 most recently created campaigns within scopeFilter (either one
  // year's window or {} for all-time — see getDashboard()), each with its
  // own performance figures scoped to that same window.
  private async computeCampaignPerformance(
    scopeFilter: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const campaigns = await this.referralCampaignModel
      .find(scopeFilter)
      .sort({ createdAt: -1 })
      .limit(3)
      .exec();

    return Promise.all(
      campaigns.map(async (campaign) => {
        const campaignId = campaign._id;
        const [
          participants,
          qualified,
          referralCount,
          successfulCount,
          rewardAgg,
        ] = await Promise.all([
          this.participantModel.countDocuments({
            campaign: campaignId,
            status: ParticipantStatus.IN_PROGRESS,
            ...scopeFilter,
          }),
          this.participantModel.countDocuments({
            campaign: campaignId,
            status: ParticipantStatus.QUALIFIED,
            ...scopeFilter,
          }),
          this.referralModel.countDocuments({
            campaign: campaignId,
            ...scopeFilter,
          }),
          this.referralModel.countDocuments({
            campaign: campaignId,
            hasCompletedChallenge: true,
            ...scopeFilter,
          }),
          this.rewardModel.aggregate<{ total: number }>([
            {
              $match: {
                campaign: campaignId,
                status: RewardStatus.PAID,
                ...scopeFilter,
              },
            },
            { $group: { _id: null, total: { $sum: '$amountPaid' } } },
          ]),
        ]);

        const conversionRate =
          referralCount === 0
            ? 0
            : Math.round((successfulCount / referralCount) * 1000) / 10;

        return {
          _id: campaignId.toString(),
          name: campaign.name,
          participants,
          referralCount,
          successfulCount,
          conversionRate: `${conversionRate}%`,
          qualified,
          rewardSpent: rewardAgg[0]?.total ?? 0,
        };
      }),
    );
  }

  // Top 3 participants ranked by successful referrals (hasCompletedChallenge
  // true) within scopeFilter (one year's window or {} for all-time).
  // transactionsGenerated reads from
  // Participant.progress.amountOfCompletedTransaction — the field this app
  // already reserved for exactly this, still always 0 today since nothing
  // increments it yet (see the Participant schema's own comment).
  private async computeTopReferrals(
    scopeFilter: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const ranked = await this.referralModel.aggregate<{
      _id: Types.ObjectId;
      successfulReferrals: number;
    }>([
      { $match: { hasCompletedChallenge: true, ...scopeFilter } },
      { $group: { _id: '$referrer', successfulReferrals: { $sum: 1 } } },
      { $sort: { successfulReferrals: -1 } },
      { $limit: 3 },
    ]);

    return Promise.all(
      ranked.map(async (row) => {
        const [participant, qualified] = await Promise.all([
          this.participantModel
            .findById(row._id)
            .populate('user', 'name')
            .exec(),
          this.referralModel.countDocuments({
            referrer: row._id,
            qualifiedAt: { $ne: null },
            ...scopeFilter,
          }),
        ]);
        const userDoc = participant?.user as unknown as
          { name?: string } | undefined;

        return {
          participantId: row._id.toString(),
          name: userDoc?.name ?? null,
          successfulReferrals: row.successfulReferrals,
          qualified,
          transactionsGenerated:
            participant?.progress.amountOfCompletedTransaction ?? 0,
        };
      }),
    );
  }

  // Current status distribution of participants who joined within
  // scopeFilter (one year's window or {} for all-time).
  private async computeQualificationStatus(
    scopeFilter: Record<string, unknown>,
  ): Promise<Record<string, number>> {
    const rows = await this.participantModel.aggregate<{
      _id: ParticipantStatus;
      count: number;
    }>([
      { $match: scopeFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const counts = new Map(rows.map((r) => [r._id, r.count]));

    return {
      inProgress: counts.get(ParticipantStatus.IN_PROGRESS) ?? 0,
      qualified: counts.get(ParticipantStatus.QUALIFIED) ?? 0,
      paid: counts.get(ParticipantStatus.PAID) ?? 0,
      disqualified: counts.get(ParticipantStatus.DISQUALIFIED) ?? 0,
      expired: counts.get(ParticipantStatus.EXPIRED) ?? 0,
      left: counts.get(ParticipantStatus.LEFT) ?? 0,
    };
  }

  // ---------------------------------------------------------------------
  // Admin — Participants (list + detail).
  // ---------------------------------------------------------------------

  // Paginated, searchable, filterable — mirrors every other admin list in
  // this app. Built as an aggregation (not find()+populate()+N per-row
  // counts) specifically to avoid an N+1 query per row, same reasoning this
  // app already applies to every other list endpoint.
  async listParticipantsAdmin(dto: ListReferralParticipantsDto): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const pipeline = this.buildParticipantAggregationPipeline(dto);
    pipeline.push(
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    );

    const [agg] = await this.participantModel.aggregate<{
      data: AdminParticipantAggregateRow[];
      totalCount: { count: number }[];
    }>(pipeline);

    const total = agg?.totalCount[0]?.count ?? 0;
    const results = (agg?.data ?? []).map((row) =>
      this.shapeAdminParticipantRow(row),
    );

    return { results, total, page, limit };
  }

  // Unpaginated CSV of the same filtered set — shares the exact same
  // $match/$lookup stages listParticipantsAdmin() uses (built once, so a fix
  // to one doesn't need repeating in the other), just without the $facet.
  async exportParticipantsCsv(
    dto: ListReferralParticipantsDto,
  ): Promise<string> {
    const pipeline = this.buildParticipantAggregationPipeline(dto);
    pipeline.push({ $sort: { createdAt: -1 } });

    const rows =
      await this.participantModel.aggregate<AdminParticipantAggregateRow>(
        pipeline,
      );

    const csvRows = rows.map((row) => {
      const campaignDoc = row.campaignDoc;
      const referralAmount =
        campaignDoc?.referralRequirement?.referralAmount ?? 0;
      const progressPercentage = referralAmount
        ? Math.min(
            100,
            Math.round((row.progress.amountOfReferrals / referralAmount) * 100),
          )
        : 0;
      return {
        _id: row._id.toString(),
        slug: row.slug ?? '',
        participantName: row.userDoc?.name ?? '',
        participantEmail: row.userDoc?.email ?? '',
        campaignName: campaignDoc?.name ?? '',
        referralCode: row.referralCode,
        status: row.status,
        referredUsers: row.referredUsersCount,
        qualified: row.qualifiedCount,
        progressPercentage,
        reward: campaignDoc?.rewardAmount ?? '',
        joinedAt: row.joinedAt,
      };
    });

    return toCsv(csvRows, [
      '_id',
      'slug',
      'participantName',
      'participantEmail',
      'campaignName',
      'referralCode',
      'status',
      'referredUsers',
      'qualified',
      'progressPercentage',
      'reward',
      'joinedAt',
    ]);
  }

  private buildParticipantAggregationPipeline(
    dto: ListReferralParticipantsDto,
  ): PipelineStage[] {
    const match: Record<string, unknown> = {
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.campaignId
        ? { campaign: new Types.ObjectId(dto.campaignId) }
        : {}),
      ...buildDateRangeFilter(dto),
    };

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userDoc',
        },
      },
      { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'referralcampaigns',
          localField: 'campaign',
          foreignField: '_id',
          as: 'campaignDoc',
        },
      },
      { $unwind: { path: '$campaignDoc', preserveNullAndEmptyArrays: true } },
    ];

    if (dto.search) {
      const re = new RegExp(escapeRegex(dto.search), 'i');
      pipeline.push({
        $match: { $or: [{ 'userDoc.name': re }, { 'campaignDoc.name': re }] },
      });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'referrals',
          localField: '_id',
          foreignField: 'referrer',
          as: 'referralDocs',
        },
      },
      {
        $addFields: {
          referredUsersCount: { $size: '$referralDocs' },
          qualifiedCount: {
            $size: {
              $filter: {
                input: '$referralDocs',
                as: 'r',
                cond: { $ne: ['$$r.qualifiedAt', null] },
              },
            },
          },
        },
      },
    );

    return pipeline;
  }

  // deadline reads as the participant's own personal deadline (joinedAt +
  // the campaign's qualificationWindow), falling back to the campaign's own
  // endDate when no qualificationWindow is set — judgment call, flagged:
  // qualificationWindow exists specifically to describe "how long a
  // referrer has after joining," which reads as the more literal "deadline"
  // than the campaign's own overall end date. reward is the campaign's
  // configured rewardAmount (the "up to" figure), not a real Reward row's
  // amountPaid — a participant may not have a Reward document yet at all.
  private shapeAdminParticipantRow(
    row: AdminParticipantAggregateRow,
  ): Record<string, unknown> {
    const campaignDoc = row.campaignDoc;
    const referralAmount: number =
      campaignDoc?.referralRequirement?.referralAmount ?? 0;
    const progressPercentage = referralAmount
      ? Math.min(
          100,
          Math.round((row.progress.amountOfReferrals / referralAmount) * 100),
        )
      : 0;
    const deadline = campaignDoc?.qualificationWindow
      ? new Date(
          new Date(row.joinedAt).getTime() +
            campaignDoc.qualificationWindow * MS_PER_DAY,
        )
      : (campaignDoc?.endDate ?? null);

    return {
      _id: row._id.toString(),
      slug: row.slug ?? null,
      participant: row.userDoc
        ? { _id: row.userDoc._id.toString(), name: row.userDoc.name }
        : null,
      campaign: campaignDoc
        ? { _id: campaignDoc._id.toString(), name: campaignDoc.name }
        : null,
      referredUsers: row.referredUsersCount,
      qualified: row.qualifiedCount,
      progressPercentage,
      deadline,
      reward: campaignDoc?.rewardAmount ?? null,
      status: row.status,
    };
  }

  // Rich single-participant admin detail view: insights, this participant's
  // own referrals (paginated), the referred users' real marketplace
  // transactions (paginated), and a 3-entry recent timeline.
  async getParticipantDetailAdmin(
    id: string,
    dto: ReferralParticipantDetailDto,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Participant not found');
    }
    const participant = await this.participantModel
      .findById(id)
      .populate('user', 'name email')
      .populate('campaign')
      .exec();
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    const campaign =
      participant.campaign as unknown as ReferralCampaignDocument;
    const participantUserId = (
      participant.user as unknown as { _id: Types.ObjectId }
    )._id;

    const referralsPage = dto.referralsPage ?? 1;
    const referralsLimit = dto.referralsLimit ?? 10;
    const transactionsPage = dto.transactionsPage ?? 1;
    const transactionsLimit = dto.transactionsLimit ?? 10;

    const [
      referredUsersCount,
      qualifiedCount,
      rewardPaidAgg,
      referralDocs,
      referralsTotal,
      referredUserIds,
      recentAuditLogs,
      ownMostRecentTransaction,
    ] = await Promise.all([
      this.referralModel.countDocuments({ referrer: participant._id }),
      this.referralModel.countDocuments({
        referrer: participant._id,
        qualifiedAt: { $ne: null },
      }),
      this.rewardModel.aggregate<{ total: number }>([
        { $match: { participant: participant._id, status: RewardStatus.PAID } },
        { $group: { _id: null, total: { $sum: '$amountPaid' } } },
      ]),
      this.referralModel
        .find({ referrer: participant._id })
        .populate('referred', 'name email')
        .populate('transaction', 'reference amount status')
        .sort({ createdAt: -1 })
        .skip((referralsPage - 1) * referralsLimit)
        .limit(referralsLimit)
        .exec(),
      this.referralModel.countDocuments({ referrer: participant._id }),
      this.referralModel.distinct('referred', { referrer: participant._id }),
      this.auditLogService.findForEntity(
        'referral_participant',
        participant._id.toString(),
        3,
      ),
      // The detail header's own transaction reference — the participant's
      // (the referrer's own) most recent real Transaction as buyer or
      // seller, per explicit instruction ("use the referral guy's id to get
      // all his transaction"). Distinct from the transactions sub-table
      // below, which is about their *referred* users' own transactions.
      this.transactionModel
        .findOne({
          $or: [{ buyer: participantUserId }, { seller: participantUserId }],
        })
        .select('reference')
        .sort({ createdAt: -1 })
        .exec(),
    ]);

    const [transactionDocs, transactionsTotal] = await Promise.all([
      this.transactionModel
        .find({
          $or: [
            { buyer: { $in: referredUserIds } },
            { seller: { $in: referredUserIds } },
          ],
        })
        .populate('listing', 'title')
        .populate('buyer', 'name')
        .populate('seller', 'name')
        .sort({ createdAt: -1 })
        .skip((transactionsPage - 1) * transactionsLimit)
        .limit(transactionsLimit)
        .exec(),
      this.transactionModel.countDocuments({
        $or: [
          { buyer: { $in: referredUserIds } },
          { seller: { $in: referredUserIds } },
        ],
      }),
    ]);

    return {
      _id: participant._id.toString(),
      slug: participant.slug ?? null,
      status: participant.status,
      participant: {
        _id: participantUserId.toString(),
        name: (participant.user as unknown as { name?: string }).name,
        email: (participant.user as unknown as { email?: string }).email,
      },
      campaign: { _id: campaign._id.toString(), name: campaign.name },
      joinedAt: participant.joinedAt,
      // The participant's own (the referrer's) most recent real Transaction
      // reference, e.g. "TXN-2026-00044" — null if they've never
      // transacted on the marketplace themselves.
      transactionReference: ownMostRecentTransaction?.reference ?? null,
      insights: {
        potentialReward: campaign.rewardAmount,
        referredUsers: referredUsersCount,
        qualifiedReferrals: qualifiedCount,
        rewardAmountPaid: rewardPaidAgg[0]?.total ?? 0,
      },
      referredUsers: {
        results: referralDocs.map((r) => this.shapeAdminReferralRow(r)),
        total: referralsTotal,
        page: referralsPage,
        limit: referralsLimit,
      },
      transactions: {
        results: transactionDocs.map((t) => this.shapeAdminTransactionRow(t)),
        total: transactionsTotal,
        page: transactionsPage,
        limit: transactionsLimit,
      },
      timeline: recentAuditLogs.map((log) => ({
        event: log.event,
        label: describeEvent(log.event),
        createdAt: log.createdAt,
      })),
    };
  }

  private shapeAdminReferralRow(
    referral: ReferralDocument,
  ): Record<string, unknown> {
    const referredUser = referral.referred as unknown as
      { _id: Types.ObjectId; name?: string; email?: string } | undefined;
    const transaction = referral.transaction as unknown as
      | {
          _id: Types.ObjectId;
          reference?: string;
          amount?: number;
          status?: string;
        }
      | undefined;
    return {
      id: referral._id.toString(),
      slug: referral.slug ?? null,
      referredUser: referredUser
        ? { id: referredUser._id.toString(), name: referredUser.name }
        : null,
      referredAt: referral.referredAt,
      qualifiedAt: referral.qualifiedAt,
      hasCompletedChallenge: referral.hasCompletedChallenge,
      // The real Transaction that satisfied this referral's qualifying
      // task — null while still in progress / never qualified.
      transaction: transaction
        ? {
            id: transaction._id.toString(),
            reference: transaction.reference,
            amount: transaction.amount,
            status: transaction.status,
          }
        : null,
    };
  }

  private shapeAdminTransactionRow(
    transaction: TransactionDocument,
  ): Record<string, unknown> {
    const listing = transaction.listing as unknown as
      { title?: string } | undefined;
    const buyer = transaction.buyer as unknown as { name?: string } | undefined;
    const seller = transaction.seller as unknown as
      { name?: string } | undefined;
    return {
      id: transaction._id.toString(),
      productName: listing?.title ?? null,
      amount: transaction.amount,
      date: transaction.createdAt,
      buyer: buyer?.name ?? null,
      seller: seller?.name ?? null,
      status: transaction.status,
    };
  }

  // ---------------------------------------------------------------------
  // Admin — Rewards (list).
  // ---------------------------------------------------------------------

  async listRewardsAdmin(dto: ListReferralRewardsDto): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const pipeline = this.buildRewardAggregationPipeline(dto);
    pipeline.push(
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    );

    const [agg] = await this.rewardModel.aggregate<{
      data: AdminRewardAggregateRow[];
      totalCount: { count: number }[];
    }>(pipeline);

    const total = agg?.totalCount[0]?.count ?? 0;
    const results = (agg?.data ?? []).map((row) =>
      this.shapeAdminRewardRow(row),
    );

    return { results, total, page, limit };
  }

  // Unpaginated CSV of the same filtered set — shares the exact same
  // $match/$lookup stages listRewardsAdmin() uses, just without the $facet.
  async exportRewardsCsv(dto: ListReferralRewardsDto): Promise<string> {
    const pipeline = this.buildRewardAggregationPipeline(dto);
    pipeline.push({ $sort: { createdAt: -1 } });

    const rows =
      await this.rewardModel.aggregate<AdminRewardAggregateRow>(pipeline);

    const csvRows = rows.map((row) => ({
      _id: row._id.toString(),
      slug: row.slug ?? '',
      participantName: row.userDoc?.name ?? '',
      participantEmail: row.userDoc?.email ?? '',
      campaignName: row.campaignDoc?.name ?? '',
      reward: row.campaignDoc?.rewardAmount ?? '',
      amountPaid: row.amountPaid,
      qualifiedOn: row.referralDoc?.qualifiedAt ?? '',
      payment: row.status,
      schedule: row.campaignDoc?.paymentSchedule ?? '',
      createdAt: row.createdAt,
    }));

    return toCsv(csvRows, [
      '_id',
      'slug',
      'participantName',
      'participantEmail',
      'campaignName',
      'reward',
      'amountPaid',
      'qualifiedOn',
      'payment',
      'schedule',
      'createdAt',
    ]);
  }

  private buildRewardAggregationPipeline(
    dto: ListReferralRewardsDto,
  ): PipelineStage[] {
    const match: Record<string, unknown> = {
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.campaignId
        ? { campaign: new Types.ObjectId(dto.campaignId) }
        : {}),
      ...buildDateRangeFilter(dto),
    };

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: 'participants',
          localField: 'participant',
          foreignField: '_id',
          as: 'participantDoc',
        },
      },
      {
        $unwind: { path: '$participantDoc', preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'participantDoc.user',
          foreignField: '_id',
          as: 'userDoc',
        },
      },
      { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'referralcampaigns',
          localField: 'campaign',
          foreignField: '_id',
          as: 'campaignDoc',
        },
      },
      { $unwind: { path: '$campaignDoc', preserveNullAndEmptyArrays: true } },
    ];

    if (dto.search) {
      const re = new RegExp(escapeRegex(dto.search), 'i');
      pipeline.push({
        $match: { $or: [{ 'userDoc.name': re }, { 'campaignDoc.name': re }] },
      });
    }

    // The Referral this Reward corresponds to — same (campaign, referrer,
    // referred) triple identifies it — resolved for qualifiedOn only.
    pipeline.push(
      {
        $lookup: {
          from: 'referrals',
          let: {
            campaign: '$campaign',
            referrer: '$participant',
            referred: '$referred',
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$campaign', '$$campaign'] },
                    { $eq: ['$referrer', '$$referrer'] },
                    { $eq: ['$referred', '$$referred'] },
                  ],
                },
              },
            },
            { $project: { qualifiedAt: 1 } },
          ],
          as: 'referralDoc',
        },
      },
      { $unwind: { path: '$referralDoc', preserveNullAndEmptyArrays: true } },
    );

    return pipeline;
  }

  // Mark-paid — a manual record that a reward's payout has actually
  // happened outside this app (no live Paystack transfer is wired for
  // Referral rewards yet). Only valid from pending — an already-paid or
  // canceled reward is left alone. amountPaid is set to the campaign's own
  // configured rewardAmount, the same figure this reward's row already
  // displays while pending (see shapeAdminRewardRow()'s own comment on why
  // `reward` reads off the campaign, not Reward.amountPaid).
  async markRewardPaid(
    id: string,
    adminId: string,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Reward not found');
    }
    const reward = await this.rewardModel.findById(id);
    if (!reward) {
      throw new NotFoundException('Reward not found');
    }
    if (reward.status !== RewardStatus.PENDING) {
      throw new BadRequestException(
        `Reward is ${reward.status} — only a pending reward can be marked as paid`,
      );
    }

    const campaign = await this.referralCampaignModel
      .findById(reward.campaign)
      .select('rewardAmount')
      .exec();
    const amountPaid = campaign?.rewardAmount ?? 0;

    reward.status = RewardStatus.PAID;
    reward.amountPaid = amountPaid;
    await reward.save();

    await this.auditLogService.record({
      entityType: 'referral_reward',
      entityId: reward._id.toString(),
      event: 'referral_reward.marked_paid',
      actor: adminId,
      oldState: RewardStatus.PENDING,
      newState: RewardStatus.PAID,
      metadata: { amountPaid },
    });

    return {
      _id: reward._id.toString(),
      slug: reward.slug ?? null,
      status: reward.status,
      amountPaid: reward.amountPaid,
    };
  }

  // Bulk variant — takes an array of reward ids. Anything not found or not
  // currently pending is skipped and reported back rather than aborting the
  // whole batch, same per-item skip-and-continue posture
  // WaitlistBulkInviteProcessor already uses for its own bulk action.
  // Campaign rewardAmounts are batch-fetched once (not per reward) to avoid
  // an N+1 query across a potentially large id list.
  async bulkMarkRewardsPaid(
    rewardIds: string[],
    adminId: string,
  ): Promise<{ markedPaid: number; skippedIds: string[] }> {
    const rewards = await this.rewardModel.find({
      _id: { $in: rewardIds.map((id) => new Types.ObjectId(id)) },
    });
    const foundIds = new Set(rewards.map((r) => r._id.toString()));
    const skippedIds = rewardIds.filter((id) => !foundIds.has(id));

    const pendingRewards = rewards.filter(
      (r) => r.status === RewardStatus.PENDING,
    );
    skippedIds.push(
      ...rewards
        .filter((r) => r.status !== RewardStatus.PENDING)
        .map((r) => r._id.toString()),
    );

    const campaignIds = [
      ...new Set(pendingRewards.map((r) => r.campaign.toString())),
    ];
    const campaigns = await this.referralCampaignModel
      .find({ _id: { $in: campaignIds } })
      .select('rewardAmount')
      .exec();
    const rewardAmountByCampaign = new Map(
      campaigns.map((c) => [c._id.toString(), c.rewardAmount]),
    );

    for (const reward of pendingRewards) {
      const amountPaid =
        rewardAmountByCampaign.get(reward.campaign.toString()) ?? 0;
      reward.status = RewardStatus.PAID;
      reward.amountPaid = amountPaid;
      await reward.save();

      await this.auditLogService.record({
        entityType: 'referral_reward',
        entityId: reward._id.toString(),
        event: 'referral_reward.marked_paid',
        actor: adminId,
        oldState: RewardStatus.PENDING,
        newState: RewardStatus.PAID,
        metadata: { amountPaid },
      });
    }

    return { markedPaid: pendingRewards.length, skippedIds };
  }

  private shapeAdminRewardRow(
    row: AdminRewardAggregateRow,
  ): Record<string, unknown> {
    return {
      _id: row._id.toString(),
      slug: row.slug ?? null,
      participant: row.userDoc
        ? { _id: row.userDoc._id.toString(), name: row.userDoc.name }
        : null,
      campaign: row.campaignDoc
        ? { _id: row.campaignDoc._id.toString(), name: row.campaignDoc.name }
        : null,
      // The campaign's configured flat reward — not Reward.amountPaid,
      // which is 0 until a reward is actually disbursed and would show
      // ₦0 for every still-pending row otherwise.
      reward: row.campaignDoc?.rewardAmount ?? null,
      qualifiedOn: row.referralDoc?.qualifiedAt ?? null,
      payment: row.status,
      schedule: row.campaignDoc?.paymentSchedule ?? null,
    };
  }

  // ---------------------------------------------------------------------
  // User-facing: browse, view own participation, join, leave.
  // ---------------------------------------------------------------------

  // Every non-draft campaign is visible to users — published/scheduled/
  // ended, not just currently-joinable ones — EXCEPT one the caller already
  // has a Participant record for (any status, not just active) — that
  // belongs under GET /referral-campaigns/me instead, not here.
  async listAvailableForUser(
    userId: string,
    dto: PaginationDto,
  ): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const participatedCampaignIds = await this.participantModel.distinct(
      'campaign',
      { user: userId },
    );
    const filter = {
      // Archived is this module's soft-delete — hidden from the available
      // browse list the same way draft is, explicit instruction ("you
      // cannot show this campaign with archive status to the user as
      // available campaign").
      status: {
        $nin: [ReferralCampaignStatus.DRAFT, ReferralCampaignStatus.ARCHIVED],
      },
      _id: { $nin: participatedCampaignIds },
    };

    const [campaigns, total, user] = await Promise.all([
      this.referralCampaignModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.referralCampaignModel.countDocuments(filter),
      this.userModel.findById(userId).select('name createdAt').exec(),
    ]);

    const results = campaigns.map((campaign) =>
      this.attachUserContext(campaign, user),
    );

    return { results, total, page, limit };
  }

  // A single available campaign, by Mongo id or internalCampaignCode — 404s
  // (same as a draft or a nonexistent one, deliberately indistinguishable)
  // if the caller already has a Participant record for it; use
  // GET /referral-campaigns/me/:idOrCode for that instead.
  async getAvailableCampaignDetail(
    idOrCode: string,
    userId: string,
  ): Promise<Record<string, unknown>> {
    const campaign = await this.findVisibleCampaignByIdOrCode(idOrCode);
    // Archived is hidden from the "available" browse detail too — same
    // indistinguishable-from-nonexistent posture as the already-participating
    // check right below. findVisibleCampaignByIdOrCode() itself deliberately
    // still resolves ARCHIVED (join()/leave()/getMyCampaignDetail() need it
    // to, same as it already does for ENDED — a campaign someone already has
    // history with shouldn't 404 just because it's since been archived).
    if (campaign.status === ReferralCampaignStatus.ARCHIVED) {
      throw new NotFoundException('Referral campaign not found');
    }
    const alreadyParticipating = await this.participantModel.exists({
      campaign: campaign._id,
      user: userId,
    });
    if (alreadyParticipating) {
      throw new NotFoundException('Referral campaign not found');
    }
    const user = await this.userModel
      .findById(userId)
      .select('name createdAt')
      .exec();
    return this.attachUserContext(campaign, user);
  }

  // Every campaign the caller has ever joined, each paired with their own
  // Participant record.
  async listMyCampaigns(
    userId: string,
    dto: PaginationDto,
  ): Promise<{
    results: {
      campaign: Record<string, unknown>;
      participant: Record<string, unknown>;
    }[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const [participants, total, user] = await Promise.all([
      this.participantModel
        .find({ user: userId })
        .populate('campaign')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.participantModel.countDocuments({ user: userId }),
      this.userModel.findById(userId).select('name createdAt').exec(),
    ]);

    const results = participants.map((p) => {
      // Read the populated campaign off the live document BEFORE
      // toObject() — afterward it's a plain object with no .toObject() of
      // its own, which attachUserContext() needs.
      const campaign = p.campaign as unknown as ReferralCampaignDocument;
      const participant = p.toObject() as unknown as Record<string, unknown>;
      delete participant.campaign;
      participant.progressPercentage = this.computeProgressPercentage(
        campaign,
        p,
      );
      return {
        campaign: this.attachUserContext(campaign, user),
        participant,
      };
    });

    return { results, total, page, limit };
  }

  // One campaign the caller has joined, by id or internalCampaignCode,
  // paired with their own Participant record (null if they've never
  // actually joined this specific one — the bare :idOrCode route above is
  // for browsing a campaign that isn't theirs yet).
  async getMyCampaignDetail(
    idOrCode: string,
    userId: string,
  ): Promise<{
    campaign: Record<string, unknown>;
    participant: Record<string, unknown> | null;
  }> {
    const campaign = await this.findVisibleCampaignByIdOrCode(idOrCode);
    const [user, participant] = await Promise.all([
      this.userModel.findById(userId).select('name createdAt').exec(),
      this.participantModel
        .findOne({ campaign: campaign._id, user: userId })
        .exec(),
    ]);

    let shapedParticipant: Record<string, unknown> | null = null;
    if (participant) {
      shapedParticipant = participant.toObject() as unknown as Record<
        string,
        unknown
      >;
      shapedParticipant.progressPercentage = this.computeProgressPercentage(
        campaign,
        participant,
      );
    }

    return {
      campaign: this.attachUserContext(campaign, user),
      participant: shapedParticipant,
    };
  }

  // First join creates the Participant document; a returning participant
  // (status left/expired/disqualified) is reused — only the status flips
  // back to in_progress, per explicit instruction. Eligibility is
  // re-validated server-side regardless of what the list endpoint showed
  // the client.
  async join(campaignId: string, userId: string): Promise<ParticipantDocument> {
    const campaign = await this.findVisibleCampaignByIdOrCode(campaignId);
    if (!JOINABLE_STATUSES.includes(campaign.status)) {
      throw new BadRequestException(
        `This campaign is ${campaign.status} and is not open for joining`,
      );
    }

    const user = await this.userModel
      .findById(userId)
      .select('name createdAt')
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (
      this.computeEligibilityStatus(
        campaign.eligibility.eligibleUsers,
        user.createdAt,
      ) !== EligibilityStatus.ELIGIBLE
    ) {
      throw new BadRequestException('You are not eligible for this campaign');
    }

    const existing = await this.participantModel.findOne({
      campaign: campaign._id,
      user: userId,
    });

    if (existing) {
      if (ACTIVE_PARTICIPANT_STATUSES.includes(existing.status)) {
        throw new ConflictException(
          'You are already participating in this campaign',
        );
      }
      const oldStatus = existing.status;
      // Rejoin — status + rejoinedAt only. joinedAt (the original join) and
      // leftAt (the last time they left) are both permanent and never
      // touched here.
      existing.status = ParticipantStatus.IN_PROGRESS;
      existing.rejoinedAt = new Date();
      await existing.save();

      await this.auditLogService.record({
        entityType: 'referral_participant',
        entityId: existing._id.toString(),
        event: 'referral_participant.rejoined',
        actor: userId,
        oldState: oldStatus,
        newState: existing.status,
      });
      await this.notifyJoinedOrLeft(userId, campaign, existing, 'joined');

      return existing;
    }

    const referralCode = this.computeReferralCode(
      user,
      campaign.internalCampaignCode,
    );
    // PAT-#### — generated once, at the true first join, never touched
    // again (a rejoin above reuses the existing document/slug entirely).
    const slug = await this.counterService.nextSlug('participant', 'PAT', 4);

    let participant: ParticipantDocument;
    try {
      participant = await this.participantModel.create({
        campaign: campaign._id,
        user: userId,
        slug,
        referralCode,
        status: ParticipantStatus.IN_PROGRESS,
        joinedAt: new Date(),
        progress: {
          amountOfReferrals: 0,
          amountOfCompletedTransaction: 0,
          amountOfCompletedSales: 0,
        },
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(
          'Could not join right now — please try again',
        );
      }
      throw err;
    }

    await this.auditLogService.record({
      entityType: 'referral_participant',
      entityId: participant._id.toString(),
      event: 'referral_participant.joined',
      actor: userId,
      newState: participant.status,
    });
    await this.notifyJoinedOrLeft(userId, campaign, participant, 'joined');

    return participant;
  }

  // Only from in_progress — a qualified/paid participation has already
  // earned its reward, and "leaving" it doesn't mean anything; a left/
  // expired/disqualified one is already inactive.
  async leave(
    campaignId: string,
    userId: string,
  ): Promise<ParticipantDocument> {
    const campaign = await this.findVisibleCampaignByIdOrCode(campaignId);
    const participant = await this.participantModel.findOne({
      campaign: campaign._id,
      user: userId,
    });
    if (!participant) {
      throw new NotFoundException('You are not a participant in this campaign');
    }
    if (participant.status !== ParticipantStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `You can't leave — your participation is currently ${participant.status}`,
      );
    }
    const oldStatus = participant.status;
    participant.status = ParticipantStatus.LEFT;
    participant.leftAt = new Date();
    await participant.save();

    await this.auditLogService.record({
      entityType: 'referral_participant',
      entityId: participant._id.toString(),
      event: 'referral_participant.left',
      actor: userId,
      oldState: oldStatus,
      newState: participant.status,
    });
    await this.notifyJoinedOrLeft(userId, campaign, participant, 'left');

    return participant;
  }

  // Shared by every join/rejoin/leave path — a push+email confirmation of
  // the action, gated by the user's own referralAndRewards notification
  // setting like every other opt-out category in this app.
  private async notifyJoinedOrLeft(
    userId: string,
    campaign: ReferralCampaignDocument,
    participant: ParticipantDocument,
    action: 'joined' | 'left',
  ): Promise<void> {
    const isJoined = action === 'joined';
    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: userId,
      type: isJoined ? 'referral_campaign_joined' : 'referral_campaign_left',
      title: isJoined
        ? 'You joined a referral campaign'
        : 'You left a referral campaign',
      body: isJoined
        ? `You're now participating in "${campaign.name}". Share your referral code to start earning.`
        : `You've left "${campaign.name}". You can rejoin anytime before it ends.`,
      data: {
        campaignId: campaign._id.toString(),
        participantId: participant._id.toString(),
      },
    });
  }

  // Resolves a raw Mongo id or the campaign's own internalCampaignCode —
  // used by every user-facing lookup (browse detail, my-campaign detail,
  // join, leave). Draft campaigns never resolve here, same "don't reveal it
  // exists" posture as PAUSED listings.
  private async findVisibleCampaignByIdOrCode(
    idOrCode: string,
  ): Promise<ReferralCampaignDocument> {
    const filter = isValidObjectId(idOrCode)
      ? { _id: idOrCode }
      : { internalCampaignCode: idOrCode };
    const campaign = await this.referralCampaignModel.findOne({
      ...filter,
      status: { $ne: ReferralCampaignStatus.DRAFT },
    });
    if (!campaign) {
      throw new NotFoundException('Referral campaign not found');
    }
    return campaign;
  }

  // eligibilityStatus + referralCode, attached fresh on every fetch — never
  // stored on the campaign document itself (explicit instruction).
  private attachUserContext(
    campaign: ReferralCampaignDocument,
    user: Pick<UserDocument, 'name' | 'createdAt' | '_id'> | null,
  ): Record<string, unknown> {
    return {
      ...campaign.toObject(),
      eligibilityStatus: this.computeEligibilityStatus(
        campaign.eligibility.eligibleUsers,
        user?.createdAt,
      ),
      referralCode: user
        ? this.computeReferralCode(user, campaign.internalCampaignCode)
        : null,
      timeLeft: this.computeTimeLeft(campaign),
    };
  }

  // "X left" counting down to endDate once the campaign is live, or "X to
  // start" counting down to its scheduled activation moment beforehand.
  // null once it's ended — there's nothing left to count.
  private computeTimeLeft(campaign: ReferralCampaignDocument): string | null {
    if (campaign.status === ReferralCampaignStatus.ENDED) {
      return null;
    }
    if (campaign.status === ReferralCampaignStatus.SCHEDULED) {
      const start = this.resolveEffectiveStartDate(campaign);
      if (start && start.getTime() > Date.now()) {
        return this.formatTimeLeft(start, 'to start');
      }
      // A scheduled campaign whose own start moment has already passed (the
      // admin hasn't flipped it to published yet) — fall through to endDate,
      // same as a published one.
    }
    return this.formatTimeLeft(campaign.endDate, 'left');
  }

  private resolveEffectiveStartDate(
    campaign: ReferralCampaignDocument,
  ): Date | null {
    if (campaign.activationDate) {
      if (campaign.activationTime) {
        const [hours, minutes] = campaign.activationTime.split(':').map(Number);
        const combined = new Date(campaign.activationDate);
        combined.setHours(hours || 0, minutes || 0, 0, 0);
        return combined;
      }
      return campaign.activationDate;
    }
    return campaign.startDate ?? null;
  }

  // Day-granularity once >= 1 day out, hour-granularity once < 1 day,
  // minute-granularity once < 1 hour — e.g. "18 days left", "24 hours to
  // start", "5 mins left".
  private formatTimeLeft(target: Date, suffix: 'left' | 'to start'): string {
    const diffMs = target.getTime() - Date.now();
    if (diffMs <= 0) {
      return suffix === 'left' ? 'Ended' : 'Starting now';
    }
    const days = Math.floor(diffMs / 86_400_000);
    if (days >= 1) {
      return `${days} day${days === 1 ? '' : 's'} ${suffix}`;
    }
    const hours = Math.floor(diffMs / 3_600_000);
    if (hours >= 1) {
      return `${hours} hour${hours === 1 ? '' : 's'} ${suffix}`;
    }
    const minutes = Math.max(1, Math.floor(diffMs / 60_000));
    return `${minutes} min${minutes === 1 ? '' : 's'} ${suffix}`;
  }

  // Judgment call, flagged: referralRequirement.referralAmount is the only
  // stated numeric target on a campaign (eachReferredTask names which task
  // types count, but carries no count of its own) — so progress is measured
  // against it via progress.amountOfReferrals. Since incrementing progress
  // on real referral/transaction/sale events isn't wired up yet (deferred,
  // per "we'd add more to it later"), this will read 0% for everyone today;
  // the computation itself is ready for when that lands.
  private computeProgressPercentage(
    campaign: ReferralCampaignDocument,
    participant: Pick<ParticipantDocument, 'progress'>,
  ): number {
    const target = campaign.referralRequirement.referralAmount;
    if (!target) {
      return 0;
    }
    const percentage = (participant.progress.amountOfReferrals / target) * 100;
    return Math.min(100, Math.round(percentage));
  }

  private computeEligibilityStatus(
    eligibleUsers: EligibleUsers,
    userCreatedAt: Date | undefined,
  ): EligibilityStatus {
    if (!userCreatedAt) {
      return EligibilityStatus.NOT_ELIGIBLE;
    }
    const daysSinceSignup = (Date.now() - userCreatedAt.getTime()) / MS_PER_DAY;

    switch (eligibleUsers) {
      case EligibleUsers.ALL_REGISTERED_USERS:
        return EligibilityStatus.ELIGIBLE;
      case EligibleUsers.NEW_USERS_ONLY:
        return daysSinceSignup <= NEW_USER_WINDOW_DAYS
          ? EligibilityStatus.ELIGIBLE
          : EligibilityStatus.NOT_ELIGIBLE;
      case EligibleUsers.EXISTING_USERS:
        return daysSinceSignup > NEW_USER_WINDOW_DAYS
          ? EligibilityStatus.ELIGIBLE
          : EligibilityStatus.NOT_ELIGIBLE;
      default:
        return EligibilityStatus.NOT_ELIGIBLE;
    }
  }

  // Deterministic, no DB lookup — the same (user, campaign) pair always
  // produces the same code, so it can be shown on a campaign a user hasn't
  // even joined yet (explicit instruction: attach it to every campaign
  // fetch, joined or not, computed at response time, never stored on the
  // campaign itself). Capped at 10 chars total (explicit instruction) — 4
  // chars of the user's name + a 6-char base36 hash of (userId, campaignCode)
  // for uniqueness, e.g. "IDOWO3F9A2". 36^6 (~2.2 billion) possible hash
  // suffixes makes a collision practically impossible at this app's scale;
  // the schema's `unique: true` index is still the real backstop.
  private computeReferralCode(
    user: Pick<UserDocument, 'name' | '_id'>,
    campaignCode: string,
  ): string {
    const namePart =
      user.name
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 4) || 'USER';
    const hash = createHash('sha256')
      .update(`${user._id.toString()}:${campaignCode}`)
      .digest('hex');
    const hashPart = BigInt(`0x${hash.slice(0, 12)}`)
      .toString(36)
      .toUpperCase()
      .padStart(6, '0')
      .slice(0, 6);
    return `${namePart}${hashPart}`;
  }
}
