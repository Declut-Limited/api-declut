import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
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
import { VerifyIdentityDto } from './dto/verify-identity.dto';
import { AdminListKycDto } from './dto/admin-list-kyc.dto';
import { UsersService } from '../users/users.service';
import { KycStatus, User, UserDocument } from '../users/schemas/user.schema';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationRecipientType } from '../notifications/schemas/notification.schema';
import { AuditLogService } from '../audit-log/audit-log.service';
import { escapeRegex } from '../common/utils/regex.util';
import { SettingsService } from '../settings/settings.service';

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
    private readonly settingsService: SettingsService,
  ) {}

  // NIN and selfie arrive together and go to the provider in one call, so
  // the selfie is always matched against the same NIN whose name is
  // checked — never a different NIN from an earlier step.
  async verifyIdentity(userId: string, dto: VerifyIdentityDto) {
    const user = await this.requireEmailVerified(userId);
    const { result, providerName } = await this.runProviderCheck((provider) =>
      provider.verifyIdentity(dto.nin, dto.selfieImageBase64, user.name),
    );
    return this.recordCheck(user, result, providerName);
  }

  // The live on/off check — AppSettings.useKycProvider is a DB setting an
  // admin can flip at any time via PATCH /admin/settings/kyc-setup, so this
  // reads it fresh on every call rather than deciding once at boot. true ->
  // calls the one bound KYC_PROVIDER (QoreIdProvider). false -> no
  // automated decision at all, straight to 'pending' for manual review.
  private async runProviderCheck(
    call: (provider: KycProvider) => Promise<KycCheckResult>,
  ): Promise<{ result: KycCheckResult; providerName: string }> {
    const settings = await this.settingsService.get();
    if (!settings.useKycProvider) {
      return {
        result: { status: 'pending', referenceId: `MANUAL-${randomUUID()}` },
        providerName: 'manual',
      };
    }
    const result = await call(this.kycProvider);
    return {
      result,
      providerName: settings.kycProvider || this.kycProvider.providerName,
    };
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
    result: KycCheckResult,
    providerName: string,
  ) {
    const userId = user._id.toString();
    const stage = KycCheckStage.IDENTITY;
    const passed = result.status === 'verified';

    const verificationStatus =
      result.status === 'verified'
        ? KycVerificationStatus.VERIFIED
        : result.status === 'pending'
          ? KycVerificationStatus.PENDING
          : KycVerificationStatus.REJECTED;

    await this.kycVerificationModel.create({
      user: userId,
      provider: providerName,
      stage,
      status: verificationStatus,
      referenceId: result.referenceId,
      failureReason: result.failureReason,
    });

    // One call settles both checks, so both flags move together.
    await this.usersService.updateKycFlags(userId, {
      verifiedNIN: passed,
      livenessChecked: passed,
    });

    const kycStatus = passed
      ? KycStatus.VERIFIED
      : result.status === 'rejected'
        ? KycStatus.REJECTED
        : KycStatus.PENDING;
    await this.usersService.setKycStatus(userId, kycStatus);

    if (kycStatus === KycStatus.VERIFIED) {
      await this.trustScoreService.recalculate(userId);
    }

    await this.notificationsService.notifyUser(userId, {
      title:
        result.status === 'verified'
          ? 'KYC check passed'
          : result.status === 'pending'
            ? 'KYC submission received'
            : 'KYC check failed',
      body:
        result.status === 'verified'
          ? `Your ${stage} check passed.`
          : result.status === 'pending'
            ? `Your ${stage} submission has been received and is pending manual review.`
            : `Your ${stage} check failed — you can try again.`,
      data: { type: 'kyc_status_change', stage, status: result.status },
    });

    // Separate, one-time "you're fully verified" event — only fires on the
    // actual transition into VERIFIED (user.kycStatus here is still the
    // pre-check value), not on every subsequent check against an
    // already-verified account.
    if (
      kycStatus === KycStatus.VERIFIED &&
      user.kycStatus !== KycStatus.VERIFIED
    ) {
      await this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: userId,
        type: 'kyc_completed',
        title: 'KYC verification complete',
        body: "You're fully verified — you can now buy and sell freely on Declut.",
        data: { type: 'kyc_completed' },
      });
    }

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
