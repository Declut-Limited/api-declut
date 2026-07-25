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
import { UsersService } from '../users/users.service';
import { KycStatus, UserDocument } from '../users/schemas/user.schema';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class KycService {
  constructor(
    @InjectModel(KycVerification.name)
    private kycVerificationModel: Model<KycVerificationDocument>,
    @Inject(KYC_PROVIDER) private readonly kycProvider: KycProvider,
    private readonly usersService: UsersService,
    private readonly trustScoreService: TrustScoreService,
    private readonly notificationsService: NotificationsService,
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
}
