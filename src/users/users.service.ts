import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  AccountStatus,
  AuthProvider,
  KycStatus,
  User,
  UserDocument,
} from './schemas/user.schema';
import {
  Transaction,
  TransactionDocument,
  TransactionStatus,
} from '../transactions/schemas/transaction.schema';
import {
  Listing,
  ListingDocument,
  ListingStatus,
} from '../listings/schemas/listing.schema';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  PrivateUserProfile,
  PublicUserProfile,
} from './interfaces/user-profile.interface';
import { CounterService } from '../common/counter/counter.service';
import { escapeRegex } from '../common/utils/regex.util';
import { buildDateRangeFilter } from '../common/utils/date-range.util';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
    private readonly counterService: CounterService,
  ) {}

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+password')
      .exec();
  }

  findByPhone(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).exec();
  }

  findByPhoneWithPassword(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).select('+password').exec();
  }

  // identifier can be an email or a phone number — disambiguated by '@'.
  findByIdentifierWithPassword(
    identifier: string,
  ): Promise<UserDocument | null> {
    return identifier.includes('@')
      ? this.findByEmailWithPassword(identifier.toLowerCase())
      : this.findByPhoneWithPassword(identifier);
  }

  findByGoogleId(googleId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ googleId }).exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+password').exec();
  }

  findByIdWithRefreshToken(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+refreshToken').exec();
  }

  async createEmailUser(params: {
    email: string;
    name: string;
    phone: string;
    password: string;
  }): Promise<UserDocument> {
    const slug = await this.counterService.nextSlug('user', 'USR', 4);
    return this.userModel.create({
      email: params.email.toLowerCase(),
      name: params.name,
      phone: params.phone,
      password: params.password,
      authProvider: AuthProvider.EMAIL_PHONE,
      emailVerified: false,
      accountStatus: AccountStatus.PENDING,
      slug,
    });
  }

  async createGoogleUser(params: {
    email: string;
    name: string;
    googleId: string;
  }): Promise<UserDocument> {
    const slug = await this.counterService.nextSlug('user', 'USR', 4);
    return this.userModel.create({
      email: params.email.toLowerCase(),
      name: params.name,
      googleId: params.googleId,
      authProvider: AuthProvider.GOOGLE,
      // Google already verified the email — no signup-OTP step needed for
      // that half. accountStatus still starts PENDING though (2026-09-17,
      // explicit instruction) — KYC verification is the other half of the
      // activation gate now, and Google sign-in doesn't skip that.
      emailVerified: true,
      accountStatus: AccountStatus.PENDING,
      slug,
    });
  }

  async getPrivateProfile(userId: string): Promise<PrivateUserProfile> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return await this.toPrivateProfile(user);
  }

  async getPublicProfile(userId: string): Promise<PublicUserProfile> {
    if (!isValidObjectId(userId)) {
      throw new NotFoundException('User not found');
    }
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toPublicProfile(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserDto,
  ): Promise<PrivateUserProfile> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.profileImage !== undefined) user.profileImage = dto.profileImage;

    await user.save();
    return await this.toPrivateProfile(user);
  }

  async setKycStatus(userId: string, kycStatus: KycStatus): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { kycStatus }).exec();
    if (kycStatus === KycStatus.VERIFIED) {
      await this.activateIfEligible(userId);
    }
  }

  async updateKycFlags(
    userId: string,
    flags: Partial<{ verifiedNIN: boolean; livenessChecked: boolean }>,
  ): Promise<void> {
    const update: Record<string, boolean> = {};
    if (flags.verifiedNIN !== undefined) {
      update['kyc.verifiedNIN'] = flags.verifiedNIN;
    }
    if (flags.livenessChecked !== undefined) {
      update['kyc.livenessChecked'] = flags.livenessChecked;
    }
    await this.userModel.updateOne({ _id: userId }, update).exec();
  }

  async setPassword(userId: string, password: string): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { password }).exec();
  }

  async setEmailVerified(userId: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { emailVerified: true })
      .exec();
    // Email verification is only half the activation gate now — see
    // activateIfEligible() below. 2026-09-17, explicit instruction.
    await this.activateIfEligible(userId);
  }

  // accountStatus only ever advances PENDING -> ACTIVE here, and only once
  // both halves are true: emailVerified (already true at creation for a
  // Google account, since Google's email arrives pre-verified) and
  // kycStatus === VERIFIED. Called from both setEmailVerified() and
  // setKycStatus() above, since either one can be the half that completes
  // the pair. Never touches a suspended/deactivated/banned account — the
  // conditional update only ever matches a still-PENDING document.
  // 2026-09-17, explicit instruction.
  private async activateIfEligible(userId: string): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('emailVerified kycStatus accountStatus')
      .exec();
    if (
      !user ||
      user.accountStatus !== AccountStatus.PENDING ||
      !user.emailVerified ||
      user.kycStatus !== KycStatus.VERIFIED
    ) {
      return;
    }
    await this.userModel
      .updateOne(
        { _id: userId, accountStatus: AccountStatus.PENDING },
        { accountStatus: AccountStatus.ACTIVE },
      )
      .exec();
  }

  async suspend(
    userId: string,
    adminId: string,
    params: {
      reason: string;
      durationDays: number;
      outcome: string;
      notes?: string;
    },
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.accountStatus = AccountStatus.SUSPENDED;
    user.suspension = {
      reason: params.reason,
      durationDays: params.durationDays,
      outcome: params.outcome,
      notes: params.notes,
      suspendedAt: new Date(),
      suspendedBy: new Types.ObjectId(adminId),
    };
    await user.save();
    return user;
  }

  async reactivate(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.accountStatus = AccountStatus.ACTIVE;
    user.suspension = undefined;
    await user.save();
    return user;
  }

  // Simpler flat status flips than suspend() — no duration/reason/outcome
  // sub-document, since none was asked for. Both undone via reactivate()
  // above, same as suspend. 2026-09-17, explicit instruction.
  async deactivate(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.accountStatus = AccountStatus.DEACTIVATED;
    await user.save();
    return user;
  }

  async ban(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.accountStatus = AccountStatus.BANNED;
    await user.save();
    return user;
  }

  // Unpaginated — the federated admin users list merges this with matching
  // Admin documents before paginating the combined set.
  adminSearchUsers(filters: {
    status?: AccountStatus;
    search?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<UserDocument[]> {
    const query: Record<string, unknown> = {
      ...buildDateRangeFilter(filters),
    };
    if (filters.status) query.accountStatus = filters.status;
    if (filters.search) {
      const re = new RegExp(escapeRegex(filters.search), 'i');
      query.$or = [{ name: re }, { email: re }];
    }
    return this.userModel.find(query).sort({ createdAt: -1 }).exec();
  }

  findByIdOrSlug(idOrSlug: string): Promise<UserDocument | null> {
    return isValidObjectId(idOrSlug)
      ? this.userModel.findById(idOrSlug).exec()
      : this.userModel.findOne({ slug: idOrSlug }).exec();
  }

  // Backs the admin Dashboard "new users" card — `until` is only used for the prior-period comparison.
  countNewInPeriod(since?: Date, until?: Date): Promise<number> {
    const filter = since
      ? { createdAt: until ? { $gte: since, $lt: until } : { $gte: since } }
      : {};
    return this.userModel.countDocuments(filter).exec();
  }

  // Set only by BankAccountsService.create() — the one place a User can ever gain payout details.
  async setHasPayoutDetails(userId: string, value: boolean): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { hasPayoutDetails: value })
      .exec();
  }

  async setRefreshToken(
    userId: string,
    refreshToken: { hashedToken: string; expiresAt: Date },
  ): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { refreshToken }).exec();
  }

  async clearRefreshToken(userId: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { $unset: { refreshToken: 1 } })
      .exec();
  }

  async addDeviceTokens(userId: string, tokens: string[]): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: userId },
        { $addToSet: { deviceTokens: { $each: tokens } } },
      )
      .exec();
  }

  async removeDeviceToken(userId: string, token: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { $pull: { deviceTokens: token } })
      .exec();
  }

  async removeDeviceTokens(tokens: string[]): Promise<void> {
    await this.userModel
      .updateMany({}, { $pullAll: { deviceTokens: tokens } })
      .exec();
  }

  async setRatingStats(
    userId: string,
    avgRating: number,
    reviewCount: number,
  ): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { avgRating, reviewCount })
      .exec();
  }

  // listingCount matches GET /listings/mine's definition of "my listings" (deleted listings no longer exist as documents at all); soldCount/purchaseCount are transaction-outcome counts, not just listing status.
  private async getProfileStats(userId: string): Promise<{
    listingCount: number;
    soldCount: number;
    purchaseCount: number;
    totalAmountInEscrow: number;
  }> {
    const uid = new Types.ObjectId(userId);
    const [listingCount, soldCount, purchaseCount, escrowRows] =
      await Promise.all([
        this.listingModel.countDocuments({ seller: uid }),
        this.listingModel.countDocuments({
          seller: uid,
          status: ListingStatus.SOLD,
        }),
        this.transactionModel.countDocuments({
          buyer: uid,
          status: TransactionStatus.COMPLETED,
        }),
        this.transactionModel.aggregate<{ _id: null; total: number }>([
          {
            $match: {
              $or: [{ buyer: uid }, { seller: uid }],
              status: {
                $in: [
                  TransactionStatus.ESCROW_ACTIVE,
                  TransactionStatus.AWAITING_INSPECTION,
                ],
              },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
      ]);

    return {
      listingCount,
      soldCount,
      purchaseCount,
      totalAmountInEscrow: escrowRows[0]?.total ?? 0,
    };
  }

  private async toPrivateProfile(
    user: UserDocument,
  ): Promise<PrivateUserProfile> {
    const stats = await this.getProfileStats(user._id.toString());
    return {
      id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      name: user.name,
      authProvider: user.authProvider,
      emailVerified: user.emailVerified,
      kycStatus: user.kycStatus,
      kyc: user.kyc,
      accountStatus: user.accountStatus,
      slug: user.slug,
      avgRating: user.avgRating,
      reviewCount: user.reviewCount,
      hasPayoutDetails: user.hasPayoutDetails,
      profileImageUrl: user.profileImage,
      trustScore: user.trustScore,
      policyStrike: user.policyStrike,
      ...stats,
      createdAt: (user as unknown as { createdAt: Date }).createdAt,
    };
  }

  private toPublicProfile(user: UserDocument): PublicUserProfile {
    return {
      id: user._id.toString(),
      name: user.name,
      verified: user.kycStatus === KycStatus.VERIFIED,
      avgRating: user.avgRating,
      reviewCount: user.reviewCount,
      hasPayoutDetails: user.hasPayoutDetails,
    };
  }
}
