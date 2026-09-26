import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  KycCheckStage,
  KycVerification,
  KycVerificationDocument,
  KycVerificationStatus,
} from './schemas/kyc-verification.schema';
import { KYC_PROVIDER } from './providers/kyc-provider.interface';
import type {
  KycCheckResult,
  KycProvider,
} from './providers/kyc-provider.interface';
import { VerifyNinDto } from './dto/verify-nin.dto';
import { LivenessCheckDto } from './dto/liveness-check.dto';
import { AdminListKycDto } from './dto/admin-list-kyc.dto';
import { UsersService } from '../users/users.service';
import { KycStatus, User, UserDocument } from '../users/schemas/user.schema';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { escapeRegex } from '../common/utils/regex.util';

@Injectable()
export class KycService {
  constructor(
    @InjectModel(KycVerification.name)
    private kycVerificationModel: Model<KycVerificationDocument>,
    // Registered directly (not routed through UsersService) — a read-only
    // admin-listing need, same avoid-a-cycle/keep-UsersService-lean pattern
    // TrustScoreModule/CategoriesService already use in this app.
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @Inject(KYC_PROVIDER) private readonly kycProvider: KycProvider,
    private readonly usersService: UsersService,
    private readonly trustScoreService: TrustScoreService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async verifyNin(userId: string, dto: VerifyNinDto) {
    const user = await this.requireEmailVerified(userId);
    const result = await this.kycProvider.verifyNin(dto.nin);
    return this.recordCheck(
      user,
      KycCheckStage.NIN,
      result,
      result.status === 'verified',
      user.kyc.livenessChecked,
    );
  }

  async checkLiveness(userId: string, dto: LivenessCheckDto) {
    const user = await this.requireEmailVerified(userId);
    const result = await this.kycProvider.checkLiveness(dto.selfieImageBase64);
    return this.recordCheck(
      user,
      KycCheckStage.LIVENESS,
      result,
      user.kyc.verifiedNIN,
      result.status === 'verified',
    );
  }

  history(userId: string): Promise<KycVerificationDocument[]> {
    return this.kycVerificationModel
      .find({ user: userId })
      .sort({ createdAt: -1 })
      .exec();
  }

  // Collapsed boolean, same convention UsersService.toPublicProfile()'s
  // `verified` field already uses — pending/rejected/unverified all read
  // false, only a real `verified` status reads true.
  async getStatus(userId: string): Promise<{ kycStatus: boolean }> {
    const user = await this.usersService.findById(userId);
    return { kycStatus: user?.kycStatus === KycStatus.VERIFIED };
  }

  private async requireEmailVerified(userId: string): Promise<UserDocument> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.emailVerified) {
      throw new BadRequestException(
        'Please verify your email before starting KYC verification',
      );
    }
    return user;
  }

  private async recordCheck(
    user: UserDocument,
    stage: KycCheckStage,
    result: KycCheckResult,
    verifiedNIN: boolean,
    livenessChecked: boolean,
  ) {
    const userId = user._id.toString();

    await this.kycVerificationModel.create({
      user: userId,
      stage,
      status:
        result.status === 'verified'
          ? KycVerificationStatus.VERIFIED
          : KycVerificationStatus.REJECTED,
      referenceId: result.referenceId,
      failureReason: result.failureReason,
    });

    if (stage === KycCheckStage.NIN) {
      await this.usersService.updateKycFlags(userId, {
        verifiedNIN: result.status === 'verified',
      });
    } else {
      await this.usersService.updateKycFlags(userId, {
        livenessChecked: result.status === 'verified',
      });
    }

    const kycStatus =
      result.status === 'rejected'
        ? KycStatus.REJECTED
        : verifiedNIN && livenessChecked
          ? KycStatus.VERIFIED
          : KycStatus.PENDING;
    await this.usersService.setKycStatus(userId, kycStatus);

    if (kycStatus === KycStatus.VERIFIED) {
      await this.trustScoreService.recalculate(userId);
    }

    await this.notificationsService.notifyUser(userId, {
      title:
        result.status === 'verified' ? 'KYC check passed' : 'KYC check failed',
      body:
        result.status === 'verified'
          ? `Your ${stage} check passed.`
          : `Your ${stage} check failed — you can try again.`,
      data: { type: 'kyc_status_change', stage, status: result.status },
    });

    return {
      status: result.status,
      referenceId: result.referenceId,
      kycStatus,
      ...(result.failureReason && { failureReason: result.failureReason }),
    };
  }

  // ---------------------------------------------------------------------
  // Admin — its own dedicated surface (src/kyc/admin-kyc.controller.ts),
  // moved off the general operational AdminController/AdminService.
  // ---------------------------------------------------------------------

  // One row per user who has ever touched KYC — either a real kycStatus
  // (an automated attempt happened) or at least one recorded attempt (an
  // admin can manually verify someone with zero real QoreID attempts, which
  // still needs to show up here). Paginated, filterable by status,
  // searchable by name/email.
  async adminList(dto: AdminListKycDto): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const filter: Record<string, unknown> = {
      kycStatus: dto.status ?? { $ne: KycStatus.UNVERIFIED },
    };
    if (dto.search) {
      const re = new RegExp(escapeRegex(dto.search), 'i');
      filter.$or = [{ name: re }, { email: re }];
    }

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('name email slug kycStatus kyc updatedAt')
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter),
    ]);

    const results = await Promise.all(
      users.map(async (user) => {
        const [attemptCount, lastAttempt] = await Promise.all([
          this.kycVerificationModel.countDocuments({ user: user._id }),
          this.kycVerificationModel
            .findOne({ user: user._id })
            .sort({ createdAt: -1 })
            .select('createdAt')
            .exec(),
        ]);
        return {
          user: {
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
            slug: user.slug ?? null,
          },
          kycStatus: user.kycStatus,
          kyc: user.kyc,
          attemptCount,
          lastAttemptAt: lastAttempt?.createdAt ?? null,
        };
      }),
    );

    return { results, total, page, limit };
  }

  // A single user's full KYC picture — current status/flags plus their
  // entire verification history embedded inline, so there's no separate
  // "get this user's kyc history" endpoint to call afterward.
  async adminGetUserDetail(idOrSlug: string): Promise<Record<string, unknown>> {
    const user = await this.usersService.findByIdOrSlug(idOrSlug);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const history = await this.kycVerificationModel
      .find({ user: user._id })
      .sort({ createdAt: -1 })
      .exec();

    return {
      user: {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        slug: user.slug ?? null,
      },
      kycStatus: user.kycStatus,
      kyc: user.kyc,
      history: history.map((h) => ({
        _id: h._id.toString(),
        stage: h.stage,
        status: h.status,
        referenceId: h.referenceId,
        failureReason: h.failureReason ?? null,
        createdAt: h.createdAt,
      })),
    };
  }

  // The admin override — moved here from the operational AdminController/
  // AdminService (was PATCH /admin/users/:id/kyc, gated users/write; now
  // PATCH /admin/kyc/user/:idOrSlug, gated kyc/write). Same underlying
  // effect (UsersService.setKycStatus() + a trust-score recalc once
  // verified), now also audit-logged — a gap in the original, since every
  // other admin state-changing action in this app writes to AuditLog.
  async adminOverrideStatus(
    idOrSlug: string,
    status: KycStatus,
    adminId: string,
  ): Promise<Record<string, unknown>> {
    const user = await this.usersService.findByIdOrSlug(idOrSlug);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const oldStatus = user.kycStatus;
    const userId = user._id.toString();

    await this.usersService.setKycStatus(userId, status);
    if (status === KycStatus.VERIFIED) {
      await this.trustScoreService.recalculate(userId);
    }

    await this.auditLogService.record({
      entityType: 'user',
      entityId: userId,
      event: 'kyc.status_overridden',
      actor: adminId,
      oldState: oldStatus,
      newState: status,
    });

    return this.adminGetUserDetail(userId);
  }
}
