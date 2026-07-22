import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  AuthProvider,
  KycStatus,
  User,
  UserDocument,
  UserRole,
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

  findByGoogleId(googleId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ googleId }).exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  createEmailUser(params: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<UserDocument> {
    return this.userModel.create({
      email: params.email.toLowerCase(),
      name: params.name,
      passwordHash: params.passwordHash,
      authProvider: AuthProvider.EMAIL,
      role: UserRole.USER,
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
      role: UserRole.USER,
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
    await this.userModel.updateOne({ _id: userId }, { avgRating, reviewCount }).exec();
  }

  async adminListUsers(
    page: number,
    limit: number,
    role?: UserRole,
  ): Promise<{ results: PrivateUserProfile[]; total: number; page: number; limit: number }> {
    const filter = role ? { role } : {};
    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter),
    ]);
    return { results: users.map((u) => this.toPrivateProfile(u)), total, page, limit };
  }

  // Ongoing admin-creation path once at least one admin exists (the very
  // first admin can't come from here — see scripts/seed-admin.ts for that
  // bootstrap step, since promoting requires an admin to already be logged
  // in to call this).
  async promoteToAdmin(userId: string): Promise<PrivateUserProfile> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.role = UserRole.ADMIN;
    await user.save();
    return this.toPrivateProfile(user);
  }

  private toPrivateProfile(user: UserDocument): PrivateUserProfile {
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      authProvider: user.authProvider,
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
