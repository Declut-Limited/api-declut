import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  KycVerification,
  KycVerificationDocument,
  KycVerificationStatus,
} from './schemas/kyc-verification.schema';
import { KYC_PROVIDER } from './providers/kyc-provider.interface';
import type { KycProvider } from './providers/kyc-provider.interface';
import { VerifyKycDto } from './dto/verify-kyc.dto';
import { UsersService } from '../users/users.service';
import { KycStatus } from '../users/schemas/user.schema';
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

  async verify(userId: string, dto: VerifyKycDto) {
    await this.usersService.setKycStatus(userId, KycStatus.PENDING);

    let result;
    try {
      result = await this.kycProvider.verifyIdentity({
        nin: dto.nin,
        selfieImageBase64: dto.selfieImageBase64,
      });
    } catch (err) {
      // A provider/config error is not the same as "this person failed
      // verification" — leaving kycStatus at 'pending' would misleadingly
      // suggest a check is still in progress. Revert to unverified so a
      // retry is unambiguous, and no KycVerification record gets created
      // for a call that never actually completed.
      await this.usersService.setKycStatus(userId, KycStatus.UNVERIFIED);
      throw err;
    }

    await this.kycVerificationModel.create({
      user: userId,
      status:
        result.status === 'verified'
          ? KycVerificationStatus.VERIFIED
          : KycVerificationStatus.REJECTED,
      referenceId: result.referenceId,
      failureReason: result.failureReason,
    });

    await this.usersService.setKycStatus(
      userId,
      result.status === 'verified' ? KycStatus.VERIFIED : KycStatus.REJECTED,
    );

    // Not one of CLAUDE.md's three listed trigger events (transaction
    // completed / review created / dispute resolved), but KYC verified IS
    // one of the formula's inputs — recalculating here avoids a freshly
    // verified user's score sitting stale until their next transaction or
    // review.
    if (result.status === 'verified') {
      await this.trustScoreService.recalculate(userId);
    }

    await this.notificationsService.notifyUser(userId, {
      title: result.status === 'verified' ? 'KYC verified' : 'KYC verification failed',
      body:
        result.status === 'verified'
          ? 'Your identity has been verified.'
          : 'We couldn\'t verify your identity — you can try again.',
      data: { type: 'kyc_status_change', status: result.status },
    });

    return {
      status: result.status,
      referenceId: result.referenceId,
      ...(result.failureReason && { failureReason: result.failureReason }),
    };
  }

  history(userId: string): Promise<KycVerificationDocument[]> {
    return this.kycVerificationModel
      .find({ user: userId })
      .sort({ createdAt: -1 })
      .exec();
  }
}
