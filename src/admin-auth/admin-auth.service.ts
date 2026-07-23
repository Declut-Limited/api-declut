import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { Admin, AdminDocument } from './schemas/admin.schema';
import {
  AdminRefreshToken,
  AdminRefreshTokenDocument,
} from './schemas/admin-refresh-token.schema';
import { AdminLoginDto } from './dto/admin-login.dto';
import { CreateSubAdminDto } from './dto/create-sub-admin.dto';
import { AdminRefreshTokenDto } from './dto/admin-refresh-token.dto';
import { AdminForgotPasswordDto } from './dto/admin-forgot-password.dto';
import { AdminResendOtpDto } from './dto/admin-resend-otp.dto';
import { AdminVerifyOtpDto } from './dto/admin-verify-otp.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import { AdminRefreshTokenPayload } from './interfaces/admin-jwt-payload.interface';
import { PasswordResetTokenService } from '../auth/password-reset-token.service';
import { EmailService } from '../email/email.service';

export interface AdminTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AdminProfile {
  id: string;
  email: string;
  name: string;
  createdBy?: string;
  createdAt: Date;
}

/**
 * Structurally identical shape to AuthService (login/refresh/logout,
 * stateless forgot-password/OTP/reset-password) but operating on the
 * separate Admin collection with its own JWT secrets — see
 * src/auth/password-reset-token.service.ts's doc comment for why the
 * reset/OTP tokens are never stored in the DB, and CLAUDE.md's "Admin Auth
 * Model" section for why this is a fully separate stack rather than a role
 * flag on User.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
    @InjectModel(AdminRefreshToken.name)
    private adminRefreshTokenModel: Model<AdminRefreshTokenDocument>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly passwordResetTokens: PasswordResetTokenService,
    private readonly emailService: EmailService,
  ) {}

  async login(dto: AdminLoginDto): Promise<AdminTokenPair> {
    const admin = await this.adminModel
      .findOne({ email: dto.email.toLowerCase() })
      .select('+passwordHash')
      .exec();

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const matches = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(admin);
  }

  // No "first sub-admin" bootstrap problem here beyond what
  // scripts/seed-admin.ts already solves — every admin after the seeded
  // root is created by an already-authenticated admin via this method,
  // gated by AdminJwtAuthGuard at the controller level.
  async createSubAdmin(
    creatorAdminId: string,
    dto: CreateSubAdminDto,
  ): Promise<AdminProfile> {
    const existing = await this.adminModel.findOne({
      email: dto.email.toLowerCase(),
    });
    if (existing) {
      throw new ConflictException('An admin with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds());
    const admin = await this.adminModel.create({
      email: dto.email.toLowerCase(),
      name: dto.name,
      passwordHash,
      createdBy: creatorAdminId,
    });

    return this.toProfile(admin);
  }

  async getProfile(adminId: string): Promise<AdminProfile> {
    const admin = await this.adminModel.findById(adminId).exec();
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }
    return this.toProfile(admin);
  }

  async refresh(dto: AdminRefreshTokenDto): Promise<AdminTokenPair> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);

    const stored = await this.adminRefreshTokenModel.findOne({
      jti: payload.jti,
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const matches = await bcrypt.compare(dto.refreshToken, stored.tokenHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    stored.revokedAt = new Date();
    await stored.save();

    const admin = await this.adminModel.findById(payload.sub);
    if (!admin) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens(admin);
  }

  async logout(dto: AdminRefreshTokenDto): Promise<void> {
    let payload: AdminRefreshTokenPayload;
    try {
      payload = await this.verifyRefreshToken(dto.refreshToken);
    } catch {
      return;
    }

    await this.adminRefreshTokenModel.updateOne(
      { jti: payload.jti },
      { revokedAt: new Date() },
    );
  }

  private static readonly INERT_SUBJECT = '000000000000000000000000';

  async forgotPassword(
    dto: AdminForgotPasswordDto,
  ): Promise<{ otpToken: string; message: string }> {
    const admin = await this.adminModel
      .findOne({ email: dto.email.toLowerCase() })
      .select('+passwordHash')
      .exec();
    const message =
      'If that email is registered, a verification code has been sent.';

    if (!admin) {
      const otpToken = await this.passwordResetTokens.signOtpToken({
        sub: AdminAuthService.INERT_SUBJECT,
        otp: this.passwordResetTokens.generateOtp(),
        secret: this.passwordResetSecret(),
        expiresIn: this.otpExpiry(),
        saltRounds: this.saltRounds(),
      });
      return { otpToken, message };
    }

    const otp = this.passwordResetTokens.generateOtp();
    const otpToken = await this.passwordResetTokens.signOtpToken({
      sub: admin._id.toString(),
      otp,
      secret: this.passwordResetSecret(),
      expiresIn: this.otpExpiry(),
      saltRounds: this.saltRounds(),
    });

    await this.emailService.sendOtpEmail(
      admin.email,
      admin.name,
      otp,
      this.otpExpiryMinutes(),
    );

    return { otpToken, message };
  }

  async resendOtp(
    dto: AdminResendOtpDto,
  ): Promise<{ otpToken: string; message: string }> {
    const { sub } = await this.passwordResetTokens.decodeOtpToken(
      dto.otpToken,
      this.passwordResetSecret(),
    );
    const message =
      'If that email is registered, a new verification code has been sent.';

    if (sub === AdminAuthService.INERT_SUBJECT) {
      const otpToken = await this.passwordResetTokens.signOtpToken({
        sub: AdminAuthService.INERT_SUBJECT,
        otp: this.passwordResetTokens.generateOtp(),
        secret: this.passwordResetSecret(),
        expiresIn: this.otpExpiry(),
        saltRounds: this.saltRounds(),
      });
      return { otpToken, message };
    }

    const admin = await this.adminModel.findById(sub).exec();
    if (!admin) {
      throw new BadRequestException('Invalid or expired token');
    }

    const otp = this.passwordResetTokens.generateOtp();
    const otpToken = await this.passwordResetTokens.signOtpToken({
      sub: admin._id.toString(),
      otp,
      secret: this.passwordResetSecret(),
      expiresIn: this.otpExpiry(),
      saltRounds: this.saltRounds(),
    });

    await this.emailService.sendOtpEmail(
      admin.email,
      admin.name,
      otp,
      this.otpExpiryMinutes(),
    );

    return { otpToken, message };
  }

  async verifyOtp(dto: AdminVerifyOtpDto): Promise<{ resetToken: string }> {
    const { sub } = await this.passwordResetTokens.verifyOtp(
      dto.otpToken,
      dto.otp,
      this.passwordResetSecret(),
    );

    const admin = await this.adminModel
      .findById(sub)
      .select('+passwordHash')
      .exec();
    if (!admin) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const resetToken = await this.passwordResetTokens.signResetToken({
      sub: admin._id.toString(),
      passwordHash: admin.passwordHash,
      secret: this.passwordResetSecret(),
      expiresIn: this.resetTokenExpiry(),
    });

    return { resetToken };
  }

  async resetPassword(
    dto: AdminResetPasswordDto,
  ): Promise<{ message: string }> {
    const unverified = this.jwtService.decode<{ sub?: string }>(dto.resetToken);
    const admin = unverified?.sub
      ? await this.adminModel
          .findById(unverified.sub)
          .select('+passwordHash')
          .exec()
      : null;

    await this.passwordResetTokens.verifyResetToken(
      dto.resetToken,
      admin?.passwordHash,
      this.passwordResetSecret(),
    );

    const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds());
    await this.adminModel
      .updateOne({ _id: admin!._id }, { passwordHash })
      .exec();
    await this.revokeAllRefreshTokens(admin!._id.toString());

    return { message: 'Password reset successfully. Please log in again.' };
  }

  async changePassword(
    adminId: string,
    dto: AdminChangePasswordDto,
  ): Promise<{ message: string }> {
    const admin = await this.adminModel
      .findById(adminId)
      .select('+passwordHash')
      .exec();
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    const matches = await bcrypt.compare(
      dto.currentPassword,
      admin.passwordHash,
    );
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds());
    await this.adminModel.updateOne({ _id: adminId }, { passwordHash }).exec();
    await this.revokeAllRefreshTokens(adminId);

    return {
      message:
        'Password changed successfully. Please log in again on other devices.',
    };
  }

  private async revokeAllRefreshTokens(adminId: string): Promise<void> {
    await this.adminRefreshTokenModel.updateMany(
      { admin: adminId, revokedAt: { $exists: false } },
      { revokedAt: new Date() },
    );
  }

  private async verifyRefreshToken(
    token: string,
  ): Promise<AdminRefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<AdminRefreshTokenPayload>(
        token,
        {
          secret: this.config.get<string>('JWT_ADMIN_REFRESH_SECRET'),
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async issueTokens(admin: AdminDocument): Promise<AdminTokenPair> {
    const adminId = admin._id.toString();

    const accessToken = await this.jwtService.signAsync(
      { sub: adminId },
      {
        secret: this.config.get<string>('JWT_ADMIN_ACCESS_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_ADMIN_ACCESS_EXPIRY',
        ) as StringValue,
      },
    );

    const jti = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      { sub: adminId, jti },
      {
        secret: this.config.get<string>('JWT_ADMIN_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_ADMIN_REFRESH_EXPIRY',
        ) as StringValue,
      },
    );

    const decoded = this.jwtService.decode<{ exp: number }>(refreshToken);
    const tokenHash = await bcrypt.hash(refreshToken, this.saltRounds());

    await this.adminRefreshTokenModel.create({
      admin: admin._id,
      jti,
      tokenHash,
      expiresAt: new Date(decoded.exp * 1000),
    });

    return { accessToken, refreshToken };
  }

  private toProfile(admin: AdminDocument): AdminProfile {
    return {
      id: admin._id.toString(),
      email: admin.email,
      name: admin.name,
      createdBy: admin.createdBy?.toString(),
      createdAt: (admin as unknown as { createdAt: Date }).createdAt,
    };
  }

  private saltRounds(): number {
    return this.config.get<number>('BCRYPT_SALT_ROUNDS', 12);
  }

  private passwordResetSecret(): string {
    return this.config.get<string>('JWT_ADMIN_PASSWORD_RESET_SECRET') as string;
  }

  private otpExpiry(): string {
    return `${this.otpExpiryMinutes()}m`;
  }

  private otpExpiryMinutes(): number {
    return this.config.get<number>('OTP_EXPIRY_MINUTES', 10);
  }

  private resetTokenExpiry(): string {
    return `${this.config.get<number>('PASSWORD_RESET_TOKEN_EXPIRY_MINUTES', 15)}m`;
  }
}
