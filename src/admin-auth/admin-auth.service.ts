import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model, isValidObjectId } from 'mongoose';
import { randomBytes, randomUUID, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import {
  Admin,
  AdminAccountStatus,
  AdminDocument,
  DashboardPreferences,
  Phone,
} from './schemas/admin.schema';
import { normalizeNigerianPhone } from '../common/utils/phone.util';
import { generateSecurePassword } from './generate-secure-password.util';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { AdminLoginDto } from './dto/admin-login.dto';
import { CreateSubAdminDto } from './dto/create-sub-admin.dto';
import { AdminRefreshTokenDto } from './dto/admin-refresh-token.dto';
import { AdminForgotPasswordDto } from './dto/admin-forgot-password.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import { UpdateAdminRoleDto } from './dto/update-admin-role.dto';
import { UpdateAdminGeneralProfileDto } from './dto/update-admin-general-profile.dto';
import { UpdateDashboardPreferencesDto } from './dto/update-dashboard-preferences.dto';
import { AdminRefreshTokenPayload } from './interfaces/admin-jwt-payload.interface';
import {
  hashRefreshToken,
  refreshTokenMatches,
} from '../auth/refresh-token-hash.util';
import { EmailService } from '../email/email.service';
import { escapeRegex } from '../common/utils/regex.util';
import { AdminPermissions } from './interfaces/admin-permissions.interface';
import { CounterService } from '../common/counter/counter.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationRecipientType } from '../notifications/schemas/notification.schema';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { DateRangeDto } from '../common/dto/date-range.dto';

export interface AdminTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AdminProfile {
  id: string;
  slug?: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  phone?: Phone;
  accountStatus: AdminAccountStatus;
  dashboardPreferences?: DashboardPreferences;
  passwordChangedAt?: Date | null;
  lastLoginAt?: Date | null;
  initialLoginAt?: Date | null;
  lastSeenAt?: Date | null;
  lastProfileUpdateAt?: Date | null;
  title?: string;
  company?: string;
  role: { id: string; name: string; permissions: AdminPermissions } | null;
  createdBy?: string;
  createdAt: Date;
}

const PASSWORD_RESET_EXPIRY_MINUTES = 10;
const ROLE_POPULATE_FIELDS = 'name permissions';

// Mirrors AuthService for login/refresh/logout. Password reset is
// deliberately NOT the regular-user's stateless-JWT/OTP flow — see
// forgotPassword() below.
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly counterService: CounterService,
    // forwardRef both ways — see notifications.module.ts's comment on the AdminAuthModule/NotificationsModule cycle.
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
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

    // Checked only after credentials are confirmed correct — otherwise a
    // wrong-password attempt against a deactivated account would leak that
    // the account exists/its status, ahead of the generic "invalid
    // credentials" response. 2026-09-19, explicit instruction.
    if (admin.accountStatus === AdminAccountStatus.DEACTIVATED) {
      throw new ForbiddenException(
        'Your account has been deactivated - Contact an admin to restore access',
      );
    }

    // First login: stamps initialLoginAt and flips a still-PENDING admin to
    // ACTIVE (see AdminAccountStatus). Never runs again afterward —
    // initialLoginAt being already set is what "not the first login" means.
    // 2026-09-18, explicit instruction.
    const update: Record<string, unknown> = { lastLoginAt: new Date() };
    if (!admin.initialLoginAt) {
      update.initialLoginAt = new Date();
      if (admin.accountStatus === AdminAccountStatus.PENDING) {
        update.accountStatus = AdminAccountStatus.ACTIVE;
      }
    }
    await this.adminModel.updateOne({ _id: admin._id }, update).exec();

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
    const role = await this.roleModel.findById(dto.roleId).exec();
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Generated, never client-supplied (explicit instruction, 2026-09-18) —
    // the plaintext only ever exists in memory here and in the invite email
    // below, same as before; only its origin changed.
    const plaintextPassword = generateSecurePassword();
    const password = await bcrypt.hash(plaintextPassword, this.saltRounds());
    const slug = await this.counterService.nextSlug('admin', 'ADM', 4);
    const admin = await this.adminModel.create({
      email: dto.email.toLowerCase(),
      name: dto.name,
      slug,
      password,
      role: dto.roleId,
      createdBy: creatorAdminId,
    });
    await admin.populate('role', ROLE_POPULATE_FIELDS);

    // Account already exists at this point — a failed/unconfigured email
    // send must not fail the whole creation, same posture as
    // AuthService.register()'s verification-email send.
    const appUrl = this.config.get<string>('ADMIN_APP_URL', '');
    try {
      await this.emailService.sendSubAdminInviteEmail(
        admin.email,
        admin.name,
        plaintextPassword,
        `${appUrl}/login`,
      );
    } catch (err) {
      this.logger.error(
        `sendSubAdminInviteEmail failed for ${admin.email}`,
        err as Error,
      );
    }

    return this.toProfile(admin);
  }

  // Replaces the old per-admin permissions-edit endpoint — reassigns which Role this admin points at. Same guard as sub-admin creation (any authenticated admin, no extra RBAC check) — consistent with the existing flat trust model at this layer, not a new hole: an admin could already grant itself full access indirectly by creating a brand new full-permission sub-admin.
  async updateRole(
    adminId: string,
    dto: UpdateAdminRoleDto,
  ): Promise<AdminProfile> {
    const admin = await this.adminModel.findById(adminId).exec();
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    const role = await this.roleModel.findById(dto.roleId).exec();
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    admin.role = role._id;
    await admin.save();
    await admin.populate('role', ROLE_POPULATE_FIELDS);

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.ADMIN,
      recipientId: adminId,
      type: 'role_updated',
      title: 'Your role was updated',
      body: `Your role is now "${role.name}".`,
    });

    return this.toProfile(admin);
  }

  // Two flat status flips, mirroring UsersService's own
  // deactivate/reactivate — no Suspension-style metadata sub-document, since
  // none was asked for here. No 'suspend' counterpart — removed entirely
  // 2026-09-18, explicit instruction (AdminAccountStatus is now
  // pending/active/deactivated only). No 'ban' either — ban is user-only
  // (explicit instruction, 2026-09-17). Neither login() above nor
  // AdminJwtAuthGuard/PermissionsGuard currently check accountStatus — same
  // gap User's own accountStatus already has (nothing in
  // AuthService.login() checks it either) — so these set the field for
  // visibility/filtering but don't yet block API access; flagged, not
  // fixed, since enforcing it wasn't asked for.
  async deactivateAdmin(adminId: string): Promise<AdminProfile> {
    return this.setAccountStatus(adminId, AdminAccountStatus.DEACTIVATED);
  }

  async reactivateAdmin(adminId: string): Promise<AdminProfile> {
    return this.setAccountStatus(adminId, AdminAccountStatus.ACTIVE);
  }

  private async setAccountStatus(
    adminId: string,
    accountStatus: AdminAccountStatus,
  ): Promise<AdminProfile> {
    const admin = await this.adminModel.findById(adminId).exec();
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    admin.accountStatus = accountStatus;
    await admin.save();
    await admin.populate('role', ROLE_POPULATE_FIELDS);
    return this.toProfile(admin);
  }

  // Self-service (POST /admin/auth/me/deactivate) — distinct from the
  // admin-triggered deactivateAdmin() above (one admin acting on another,
  // no reason captured). Clears the refresh token and drops the live bell
  // socket in the same call as logout() does, so the admin is logged out
  // the instant this returns — the access token itself still can't be
  // revoked (stateless JWT, no blacklist), same flagged limitation as
  // logout(). Never actually deletes the document — only ever deactivated.
  async deactivateOwnAccount(
    adminId: string,
    dto: { reason: string; comment?: string },
  ): Promise<void> {
    await this.adminModel
      .updateOne(
        { _id: adminId },
        {
          $set: {
            accountStatus: AdminAccountStatus.DEACTIVATED,
            deactivatedAt: new Date(),
            deactivationReason: { reason: dto.reason, comment: dto.comment },
          },
          $unset: { refreshToken: 1 },
        },
      )
      .exec();

    this.notificationsService.disconnectAdminSockets(adminId);
  }

  // Backs RolesService.findAll()/remove() — how many admins are currently assigned to a role, computed live rather than cached (see the Role schema comment).
  countByRole(roleId: string): Promise<number> {
    return this.adminModel.countDocuments({ role: roleId }).exec();
  }

  async getProfile(adminId: string): Promise<AdminProfile> {
    const admin = await this.adminModel
      .findById(adminId)
      .populate('role', ROLE_POPULATE_FIELDS)
      .exec();
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }
    return this.toProfile(admin);
  }

  // First of 3 category-scoped admin-profile update endpoints (general
  // here; 2 more TBD). firstName/lastName/phone/email — a partial update,
  // same shape as the settings category endpoints. Whenever firstName or
  // lastName is part of this update, `name` is recomputed from both
  // (explicit instruction: keep `name` in sync rather than replacing it).
  async updateGeneralProfile(
    adminId: string,
    dto: UpdateAdminGeneralProfileDto,
  ): Promise<AdminProfile> {
    const admin = await this.adminModel.findById(adminId).exec();
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    if (dto.email && dto.email.toLowerCase() !== admin.email) {
      const existing = await this.adminModel.findOne({
        email: dto.email.toLowerCase(),
      });
      if (existing) {
        throw new ConflictException('An admin with this email already exists');
      }
      admin.email = dto.email.toLowerCase();
    }
    if (dto.phone !== undefined) {
      admin.phone = normalizeNigerianPhone(dto.phone);
    }
    if (dto.firstName !== undefined) {
      admin.firstName = dto.firstName;
    }
    if (dto.lastName !== undefined) {
      admin.lastName = dto.lastName;
    }
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      admin.name = `${admin.firstName ?? ''} ${admin.lastName ?? ''}`.trim();
    }
    admin.lastProfileUpdateAt = new Date();

    await admin.save();
    await admin.populate('role', ROLE_POPULATE_FIELDS);
    return this.toProfile(admin);
  }

  // Second of the 3 admin-profile update endpoints. Merges onto the
  // existing dashboardPreferences sub-document rather than replacing it
  // wholesale, so a partial PATCH never resets fields the caller didn't send.
  async updateDashboardPreferences(
    adminId: string,
    dto: UpdateDashboardPreferencesDto,
  ): Promise<AdminProfile> {
    const admin = await this.adminModel.findById(adminId).exec();
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    admin.dashboardPreferences = { ...admin.dashboardPreferences, ...dto };
    admin.lastProfileUpdateAt = new Date();

    await admin.save();
    await admin.populate('role', ROLE_POPULATE_FIELDS);
    return this.toProfile(admin);
  }

  // Used by PermissionsGuard (needs role.permissions populated to check
  // access) — routed through here rather than injecting the Admin model
  // directly into the guard, so the guard's only constructor deps are
  // Reflector + this already-exported service. Also used for display by
  // AdminService, which benefits from the same populate.
  findById(adminId: string): Promise<AdminDocument | null> {
    return this.adminModel
      .findById(adminId)
      .populate('role', ROLE_POPULATE_FIELDS)
      .exec();
  }

  // Used by the federated GET /admin/users/:idOrSlug detail view — same
  // id-or-slug dispatch UsersService.findByIdOrSlug() already uses. Added
  // 2026-09-18, explicit instruction (the User side of this detail view
  // already resolved by slug; the Admin side was raw-id-only until now).
  findByIdOrSlug(idOrSlug: string): Promise<AdminDocument | null> {
    const query = isValidObjectId(idOrSlug)
      ? this.adminModel.findById(idOrSlug)
      : this.adminModel.findOne({ slug: idOrSlug });
    return query.populate('role', ROLE_POPULATE_FIELDS).exec();
  }

  // Used by the admin Users federated list — the `status` filter only ever
  // narrows the User side (Admin's own AdminAccountStatus is a distinct,
  // narrower enum, not filterable through this same param — see
  // admin.schema.ts). Populates role with just its name (not the full
  // permissions object — this list view only needs it for display, unlike
  // getProfile()/findById()).
  searchAdmins(
    search?: string,
    dateRange: DateRangeDto = {},
  ): Promise<AdminDocument[]> {
    const query: Record<string, unknown> = {
      ...buildDateRangeFilter(dateRange),
    };
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ name: re }, { email: re }];
    }
    return this.adminModel
      .find(query)
      .populate('role', 'name')
      .sort({ createdAt: -1 })
      .exec();
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

    // Doesn't revoke the access token itself (stateless JWT) — just drops the live socket so the bell stops updating past logout. See NotificationsService.disconnectAdminSockets().
    this.notificationsService.disconnectAdminSockets(payload.sub);
  }

  // Link-based reset, not the regular-user OTP flow: generate a random raw token, store only its SHA-256 hash + a short expiry, email the raw token as a link. Deliberately NOT anti-enumeration, unlike the regular-User flow: Admin accounts are never self-registered (only created by another admin via createSubAdmin), so there's no public signup surface an attacker could probe — and a generic "if that email is registered..." response just left a real admin unable to tell whether their own reset email actually went out. Explicit instruction: verify the email exists first, then send and report honestly either way.
  async forgotPassword(dto: AdminForgotPasswordDto): Promise<{
    message: string;
    emailPreview: { subject: string; html: string };
  }> {
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
    const subject = 'Reset your Declut admin password';
    const html = `<p>Hi ${admin.name},</p><p>Click the link below to reset your password. This link expires in ${PASSWORD_RESET_EXPIRY_MINUTES} minutes.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`;

    await this.emailService.sendEmail({
      to: admin.email,
      toName: admin.name,
      subject,
      html,
    });

    // Message is deliberately generic — the email address that received the
    // link isn't echoed back in the response body.
    return { message: 'Successful', emailPreview: { subject, html } };
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

    const password = await bcrypt.hash(dto.password, this.saltRounds());
    await this.adminModel
      .updateOne(
        { _id: admin._id },
        {
          password,
          passwordChangedAt: new Date(),
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
    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException(
        'newPassword and confirmNewPassword do not match',
      );
    }

    const password = await bcrypt.hash(dto.newPassword, this.saltRounds());
    await this.adminModel
      .updateOne(
        { _id: adminId },
        {
          password,
          passwordChangedAt: new Date(),
          $unset: { refreshToken: 1 },
        },
      )
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
    // Shared by login() and refresh() — stamping lastSeenAt here (rather
    // than in each caller separately) covers both with one write, since
    // this update already happens on every session-creating call regardless.
    await this.adminModel
      .updateOne(
        { _id: adminId },
        {
          refreshToken: {
            hashedToken: hashRefreshToken(refreshToken),
            expiresAt: new Date(decoded.exp * 1000),
          },
          lastSeenAt: new Date(),
        },
      )
      .exec();

    return { accessToken, refreshToken };
  }

  // Requires admin.role already populated (ROLE_POPULATE_FIELDS) by the caller.
  private toProfile(admin: AdminDocument): AdminProfile {
    const role = admin.role as unknown as
      | {
          _id: { toString(): string };
          name: string;
          permissions: AdminPermissions;
        }
      | undefined;
    return {
      id: admin._id.toString(),
      slug: admin.slug,
      email: admin.email,
      name: admin.name,
      firstName: admin.firstName,
      lastName: admin.lastName,
      phone: admin.phone,
      accountStatus: admin.accountStatus,
      dashboardPreferences: admin.dashboardPreferences,
      passwordChangedAt: admin.passwordChangedAt ?? null,
      lastLoginAt: admin.lastLoginAt ?? null,
      initialLoginAt: admin.initialLoginAt ?? null,
      lastSeenAt: admin.lastSeenAt ?? null,
      lastProfileUpdateAt: admin.lastProfileUpdateAt ?? null,
      title: admin.title,
      company: admin.company,
      role: role
        ? {
            id: role._id.toString(),
            name: role.name,
            permissions: role.permissions,
          }
        : null,
      createdBy: admin.createdBy?.toString(),
      createdAt: (admin as unknown as { createdAt: Date }).createdAt,
    };
  }

  private saltRounds(): number {
    return this.config.get<number>('BCRYPT_SALT_ROUNDS', 12);
  }
}
