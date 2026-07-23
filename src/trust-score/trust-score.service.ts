import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, KycStatus } from '../users/schemas/user.schema';
import {
  Transaction,
  TransactionDocument,
  TransactionStatus,
} from '../transactions/schemas/transaction.schema';

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30;

/**
 * Standalone provider (not part of UsersModule or TransactionsModule) so it
 * can read both User and Transaction data without creating a module import
 * cycle — TransactionsModule and ReviewsModule both already depend on
 * UsersModule, so a trust-score calculator living inside either of those
 * would force the other into a circular import. Injecting the Mongoose
 * models directly here, the same way UsersService does for User, sidesteps
 * that entirely.
 *
 * Weights approved 2026-07-12 (CLAUDE.md flagged this as needing explicit
 * sign-off before wiring it into anything money/visibility-affecting):
 *   KYC verified        +20 flat
 *   Completed txns       +2 each, capped at +20 (10 txns maxes it)
 *   Average rating        (avgRating / 5) * 30, up to +30
 *   Dispute rate          -(disputedTxns / totalTxns) * 30, up to -30
 *   Account age           +1/month, capped at +10 (10 months maxes it)
 * Clamped to [0, 100]. Not exposed to end users as "how it's calculated",
 * not currently gating checkout or visibility anywhere.
 */
@Injectable()
export class TrustScoreService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
  ) {}

  async recalculate(userId: string): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      return;
    }

    const partyFilter = { $or: [{ buyer: userId }, { seller: userId }] };
    const [completedCount, disputedCount, totalCount] = await Promise.all([
      this.transactionModel.countDocuments({
        ...partyFilter,
        status: TransactionStatus.COMPLETED,
      }),
      this.transactionModel.countDocuments({
        ...partyFilter,
        status: TransactionStatus.DISPUTED,
      }),
      this.transactionModel.countDocuments(partyFilter),
    ]);

    const kycPoints = user.kycStatus === KycStatus.VERIFIED ? 20 : 0;
    const transactionPoints = Math.min(completedCount * 2, 20);
    const ratingPoints = (user.avgRating / 5) * 30;
    const disputeRate = totalCount > 0 ? disputedCount / totalCount : 0;
    const disputePenalty = disputeRate * 30;

    const createdAt = (user as unknown as { createdAt: Date }).createdAt;
    const accountAgeMonths = (Date.now() - createdAt.getTime()) / MS_PER_MONTH;
    const agePoints = Math.min(accountAgeMonths, 10);

    const raw =
      kycPoints + transactionPoints + ratingPoints - disputePenalty + agePoints;
    const trustScore = Math.max(0, Math.min(100, Math.round(raw)));

    await this.userModel.updateOne({ _id: userId }, { trustScore }).exec();
  }
}
