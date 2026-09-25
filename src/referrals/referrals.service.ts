import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { createHash } from 'crypto';
import {
  ReferralCampaign,
  ReferralCampaignDocument,
  ReferralCampaignStatus,
  EligibleUsers,
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
import { AuditLogService } from '../audit-log/audit-log.service';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { User, UserDocument } from '../users/schemas/user.schema';
import { PaginationDto } from '../common/dto/pagination.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationRecipientType } from '../notifications/schemas/notification.schema';

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
    private readonly auditLogService: AuditLogService,
    private readonly notificationsService: NotificationsService,
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
      status: { $ne: ReferralCampaignStatus.DRAFT },
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

    let participant: ParticipantDocument;
    try {
      participant = await this.participantModel.create({
        campaign: campaign._id,
        user: userId,
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
