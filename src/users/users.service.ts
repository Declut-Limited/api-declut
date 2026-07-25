import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  AuthProvider,
  KycStatus,
  User,
  UserDocument,
} from './schemas/user.schema';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  PrivateUserProfile,
  PublicUserProfile,
} from './interfaces/user-profile.interface';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

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

  createEmailUser(params: {
    email: string;
    name: string;
    phone: string;
    password: string;
  }): Promise<UserDocument> {
    return this.userModel.create({
      email: params.email.toLowerCase(),
      name: params.name,
      phone: params.phone,
      password: params.password,
      authProvider: AuthProvider.EMAIL_PHONE,
      emailVerified: false,
    });
  }

  createGoogleUser(params: {
    email: string;
    name: string;
    googleId: string;
  }): Promise<UserDocument> {
    return this.userModel.create({
      email: params.email.toLowerCase(),
      name: params.name,
      googleId: params.googleId,
      authProvider: AuthProvider.GOOGLE,
      // Google already verified the email — no signup-OTP step needed.
      emailVerified: true,
    });
  }

  async getPrivateProfile(userId: string): Promise<PrivateUserProfile> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toPrivateProfile(user);
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
    if (dto.bankCode !== undefined) user.bankCode = dto.bankCode;
    if (dto.bankName !== undefined) user.bankName = dto.bankName;
    if (dto.accountNumber !== undefined) user.accountNumber = dto.accountNumber;
    if (dto.accountName !== undefined) user.accountName = dto.accountName;

    await user.save();
    return this.toPrivateProfile(user);
  }

  async setKycStatus(userId: string, kycStatus: KycStatus): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { kycStatus }).exec();
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
  }

  async setPaystackSubaccountCode(userId: string, code: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { paystackSubaccountCode: code })
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

  async adminListUsers(
    page: number,
    limit: number,
  ): Promise<{
    results: PrivateUserProfile[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [users, total] = await Promise.all([
      this.userModel
        .find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments({}),
    ]);
    return {
      results: users.map((u) => this.toPrivateProfile(u)),
      total,
      page,
      limit,
    };
  }

  private toPrivateProfile(user: UserDocument): PrivateUserProfile {
    return {
      id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      name: user.name,
      authProvider: user.authProvider,
      emailVerified: user.emailVerified,
      kycStatus: user.kycStatus,
      kyc: user.kyc,
      trustScore: user.trustScore,
      avgRating: user.avgRating,
      reviewCount: user.reviewCount,
      bankCode: user.bankCode,
      bankName: user.bankName,
      accountNumber: user.accountNumber,
      accountName: user.accountName,
      createdAt: (user as unknown as { createdAt: Date }).createdAt,
    };
  }

  private toPublicProfile(user: UserDocument): PublicUserProfile {
    return {
      id: user._id.toString(),
      name: user.name,
      verified: user.kycStatus === KycStatus.VERIFIED,
      trustScore: user.trustScore,
      avgRating: user.avgRating,
      reviewCount: user.reviewCount,
    };
  }
}
