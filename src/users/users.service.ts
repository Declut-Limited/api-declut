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

  // Explicitly re-selects passwordHash since the schema excludes it by default.
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  findByPhone(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).exec();
  }

  findByPhoneWithPassword(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).select('+passwordHash').exec();
  }

  // Login accepts either an email or a phone number in the same field (per
  // CLAUDE.md's Auth Architecture) — the '@' check is just format
  // disambiguation, not validation (LoginDto already confirms the shape).
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

  // Explicitly re-selects passwordHash — used by change-password/reset-password,
  // which both need to verify against (or fingerprint) the current hash.
  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+passwordHash').exec();
  }

  createEmailUser(params: {
    email: string;
    name: string;
    phone: string;
    passwordHash: string;
  }): Promise<UserDocument> {
    return this.userModel.create({
      email: params.email.toLowerCase(),
      name: params.name,
      phone: params.phone,
      passwordHash: params.passwordHash,
      authProvider: AuthProvider.EMAIL,
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
      // Google already verified this email before issuing the ID token we
      // checked in GoogleOAuthService — no signup-OTP step needed here.
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

  // Used by both in-app change-password and the stateless forgot-password/
  // reset-password flow (see AuthService + PasswordResetTokenService).
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { passwordHash }).exec();
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

  // Called by ReviewsService after a review is created or removed — cached
  // rather than computed live on every profile read.
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
