import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { randomBytes, randomUUID, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { Admin, AdminDocument } from './schemas/admin.schema';
import { AdminLoginDto } from './dto/admin-login.dto';
import { CreateSubAdminDto } from './dto/create-sub-admin.dto';
import { AdminRefreshTokenDto } from './dto/admin-refresh-token.dto';
import { AdminForgotPasswordDto } from './dto/admin-forgot-password.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import { UpdateAdminPermissionsDto } from './dto/update-admin-permissions.dto';
import { AdminRefreshTokenPayload } from './interfaces/admin-jwt-payload.interface';
import {
  hashRefreshToken,
  refreshTokenMatches,
} from '../auth/refresh-token-hash.util';
import { EmailService } from '../email/email.service';
import { escapeRegex } from '../common/utils/regex.util';
import {
  ADMIN_PERMISSION_MODULES,
  AdminModulePermissions,
  AdminPermissionModule,
  AdminPermissions,
} from './interfaces/admin-permissions.interface';

export interface AdminTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AdminProfile {
  id: string;
  email: string;
  name: string;
  title?: string;
  company?: string;
  permissions: AdminPermissions;
  createdBy?: string;
  createdAt: Date;
}

const PASSWORD_RESET_EXPIRY_MINUTES = 10;

// Mirrors AuthService for login/refresh/logout. Password reset is
// deliberately NOT the regular-user's stateless-JWT/OTP flow — see
// forgotPassword() below.
@Injectable()
export class AdminAuthService {
  constructor(
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async login(dto: AdminLoginDto): Promise<AdminTokenPair> {
    const admin = await this.adminModel
      .findOne({ email: dto.email.toLowerCase() })
      .select('+password')
      .exec();

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const matches = await bcrypt.compare(dto.password, admin.password);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(admin);
  }

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

    const password = await bcrypt.hash(dto.password, this.saltRounds());
    const admin = await this.adminModel.create({
      email: dto.email.toLowerCase(),
      name: dto.name,
      password,
      title: dto.title,
      company: dto.company,
      permissions: buildPermissions(dto.permissions),
      createdBy: creatorAdminId,
    });

    return this.toProfile(admin);
  }

  // Separate from createSubAdmin() deliberately — this is a partial patch
  // (a module/action left out of the request body keeps its current value),
  // whereas creation defaults every omitted flag to false. Same guard as
  // sub-admin creation (any authenticated admin, no extra RBAC check) —
  // consistent with the existing flat trust model at this layer, not a new
  // hole: an admin could already grant itself full access indirectly by
  // creating a brand new full-permission sub-admin.
  async updatePermissions(
    adminId: string,
    dto: UpdateAdminPermissionsDto,
  ): Promise<AdminProfile> {
    const admin = await this.adminModel.findById(adminId).exec();
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    const merged: AdminPermissions = { ...admin.permissions };
    for (const moduleKey of ADMIN_PERMISSION_MODULES) {
      const patch = dto.permissions[moduleKey];
      if (!patch) continue;
      merged[moduleKey] = { ...merged[moduleKey], ...patch };
    }
    admin.permissions = merged;
    await admin.save();

    return this.toProfile(admin);
  }

  async getProfile(adminId: string): Promise<AdminProfile> {
    const admin = await this.adminModel.findById(adminId).exec();
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }
    return this.toProfile(admin);
  }

  // Used by PermissionsGuard — routed through here rather than injecting
  // the Admin model directly into the guard, so the guard's only
  // constructor deps are Reflector + this already-exported service.
  findById(adminId: string): Promise<AdminDocument | null> {
    return this.adminModel.findById(adminId).exec();
  }

  // Used by the admin Users federated list — Admins have no equivalent of
  // accountStatus, so status filters only ever narrow the User side.
  searchAdmins(search?: string): Promise<AdminDocument[]> {
    const query: Record<string, unknown> = {};
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ name: re }, { email: re }];
    }
    return this.adminModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async refresh(dto: AdminRefreshTokenDto): Promise<AdminTokenPair> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);

    const admin = await this.adminModel
      .findById(payload.sub)
      .select('+refreshToken')
      .exec();
    if (
      !admin?.refreshToken ||
      admin.refreshToken.expiresAt < new Date() ||
      !refreshTokenMatches(dto.refreshToken, admin.refreshToken.hashedToken)
    ) {
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

    await this.adminModel
      .updateOne({ _id: payload.sub }, { $unset: { refreshToken: 1 } })
      .exec();
  }

  // Link-based reset, not the regular-user OTP flow: generate a random raw
  // token, store only its SHA-256 hash + a short expiry, email the raw
  // token as a link. Deliberately NOT anti-enumeration, unlike the
  // regular-User flow: Admin accounts are never self-registered (only
  // created by another admin via createSubAdmin), so there's no public
  // signup surface an attacker could probe — and a generic "if that email
  // is registered..." response just left a real admin unable to tell
  // whether their own reset email actually went out. Explicit instruction:
  // verify the email exists first, then send and report honestly either way.
  async forgotPassword(
    dto: AdminForgotPasswordDto,
  ): Promise<{ message: string }> {
    const admin = await this.adminModel.findOne({
      email: dto.email.toLowerCase(),
    });
    if (!admin) {
      throw new NotFoundException(
        'No admin account found with that email address',
      );
    }

    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60_000,
    );

    await this.adminModel
      .updateOne(
        { _id: admin._id },
        { passwordResetToken: hashedToken, passwordResetExpires: expiresAt },
      )
      .exec();

    const appUrl = this.config.get<string>('ADMIN_APP_URL', '');
    const resetLink = `${appUrl}/reset-password/${rawToken}`;
    await this.emailService.sendEmail({
      to: admin.email,
      toName: admin.name,
      subject: 'Reset your Declut admin password',
      html: `<p>Hi ${admin.name},</p><p>Click the link below to reset your password. This link expires in ${PASSWORD_RESET_EXPIRY_MINUTES} minutes.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
    });

    return { message: `Password reset link sent to ${admin.email}` };
  }

  async verifyResetToken(token: string): Promise<{ valid: boolean }> {
    const admin = await this.findByResetToken(token);
    return { valid: !!admin };
  }

  async resetPassword(
    token: string,
    dto: AdminResetPasswordDto,
  ): Promise<{ message: string }> {
    const admin = await this.findByResetToken(token);
    if (!admin) {
      throw new UnauthorizedException(
        'This reset link has expired or is no longer valid — request a new one',
      );
    }
    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException('Passwords do not match');
    }

    const password = await bcrypt.hash(dto.password, this.saltRounds());
    await this.adminModel
      .updateOne(
        { _id: admin._id },
        {
          password,
          $unset: {
            refreshToken: 1,
            passwordResetToken: 1,
            passwordResetExpires: 1,
          },
        },
      )
      .exec();

    return { message: 'Password reset successfully. Please log in again.' };
  }

  private findByResetToken(rawToken: string): Promise<AdminDocument | null> {
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    return this.adminModel
      .findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: new Date() },
      })
      .select('+passwordResetToken')
      .exec();
  }

  async changePassword(
    adminId: string,
    dto: AdminChangePasswordDto,
  ): Promise<{ message: string }> {
    const admin = await this.adminModel
      .findById(adminId)
      .select('+password')
      .exec();
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    const matches = await bcrypt.compare(dto.currentPassword, admin.password);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const password = await bcrypt.hash(dto.newPassword, this.saltRounds());
    await this.adminModel
      .updateOne({ _id: adminId }, { password, $unset: { refreshToken: 1 } })
      .exec();

    return {
      message:
        'Password changed successfully. Please log in again on other devices.',
    };
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

    const refreshToken = await this.jwtService.signAsync(
      { sub: adminId, jti: randomUUID() },
      {
        secret: this.config.get<string>('JWT_ADMIN_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_ADMIN_REFRESH_EXPIRY',
        ) as StringValue,
      },
    );

    const decoded = this.jwtService.decode<{ exp: number }>(refreshToken);
    await this.adminModel
      .updateOne(
        { _id: adminId },
        {
          refreshToken: {
            hashedToken: hashRefreshToken(refreshToken),
            expiresAt: new Date(decoded.exp * 1000),
          },
        },
      )
      .exec();

    return { accessToken, refreshToken };
  }

  private toProfile(admin: AdminDocument): AdminProfile {
    return {
      id: admin._id.toString(),
      email: admin.email,
      name: admin.name,
      title: admin.title,
      company: admin.company,
      permissions: admin.permissions,
      createdBy: admin.createdBy?.toString(),
      createdAt: (admin as unknown as { createdAt: Date }).createdAt,
    };
  }

  private saltRounds(): number {
    return this.config.get<number>('BCRYPT_SALT_ROUNDS', 12);
  }
}

// Every module defaults to false — an invited admin starts with zero access
// until explicitly granted, never silently over-privileged. Only the known
// 9 module keys are ever stored, regardless of what the caller sends.
function buildPermissions(
  input?: Partial<
    Record<AdminPermissionModule, Partial<AdminModulePermissions>>
  >,
): AdminPermissions {
  return Object.fromEntries(
    ADMIN_PERMISSION_MODULES.map((moduleKey) => [
      moduleKey,
      {
        view: Boolean(input?.[moduleKey]?.view),
        write: Boolean(input?.[moduleKey]?.write),
        delete: Boolean(input?.[moduleKey]?.delete),
      },
    ]),
  ) as AdminPermissions;
}
