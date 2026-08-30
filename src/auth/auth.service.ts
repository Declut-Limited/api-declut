import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { UsersService } from '../users/users.service';
import {
  AuthProvider,
  KycStatus,
  UserDocument,
} from '../users/schemas/user.schema';
import {
  GoogleIdentity,
  GoogleOAuthService,
} from '../google/google-oauth.service';
import { PasswordResetTokenService } from './password-reset-token.service';
import {
  hashRefreshToken,
  refreshTokenMatches,
} from './refresh-token-hash.util';
import { EmailService, buildOtpEmailBody } from '../email/email.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { RefreshTokenPayload } from './interfaces/jwt-payload.interface';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  emailVerified: boolean;
  kycStatus: KycStatus;
}

export interface RegisterResult extends TokenPair {
  otpToken: string;
  message: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly googleOAuth: GoogleOAuthService,
    private readonly passwordResetTokens: PasswordResetTokenService,
    private readonly emailService: EmailService,
    private readonly waitlistService: WaitlistService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResult> {
    const existingEmail = await this.usersService.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    const existingPhone = await this.usersService.findByPhone(dto.phone);
    if (existingPhone) {
      throw new ConflictException('Phone number already registered');
    }

    const password = await bcrypt.hash(dto.password, this.saltRounds());
    const user = await this.usersService.createEmailUser({
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      password,
    });

    if (dto.pushToken) {
      await this.usersService.addDeviceTokens(user._id.toString(), [
        dto.pushToken,
      ]);
    }

    // A waitlist side effect must never fail a real registration.
    try {
      await this.waitlistService.markJoinedIfInvited(user.email);
    } catch (err) {
      this.logger.error(
        `Failed to mark waitlist entry joined for ${user.email}`,
        err as Error,
      );
    }

    const tokens = await this.issueTokens(user);
    const { otp, otpToken } = await this.issueEmailVerificationOtp(
      user._id.toString(),
    );

    // Account already exists at this point — a failed/unconfigured email
    // send must not fail the whole registration. resendVerificationEmail
    // exists for the client to retry the actual send.
    try {
      await this.emailService.sendOtpEmail(
        user.email,
        user.name,
        otp,
        this.otpExpiryMinutes(),
      );
    } catch (err) {
      this.logger.error(
        `Failed to send signup verification email to ${user.email}`,
        err as Error,
      );
    }

    return {
      ...tokens,
      otpToken,
      message:
        'Registration successful. Check your email for a verification code.',
    };
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.usersService.findByIdentifierWithPassword(
      dto.identifier,
    );

    if (
      !user ||
      user.authProvider !== AuthProvider.EMAIL_PHONE ||
      !user.password
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const matches = await bcrypt.compare(dto.password, user.password);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (dto.pushToken) {
      await this.usersService.addDeviceTokens(user._id.toString(), [
        dto.pushToken,
      ]);
    }

    return this.issueTokens(user);
  }

  async googleAuth(dto: GoogleAuthDto): Promise<TokenPair> {
    let identity: GoogleIdentity;
    try {
      identity = await this.googleOAuth.verifyIdToken(dto.idToken);
    } catch (err) {
      if (err instanceof InternalServerErrorException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid Google token');
    }

    let user = await this.usersService.findByGoogleId(identity.googleId);

    if (!user) {
      const existingByEmail = await this.usersService.findByEmail(
        identity.email,
      );
      if (existingByEmail) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }

      user = await this.usersService.createGoogleUser({
        email: identity.email,
        name: identity.name,
        googleId: identity.googleId,
      });

      try {
        await this.waitlistService.markJoinedIfInvited(user.email);
      } catch (err) {
        this.logger.error(
          `Failed to mark waitlist entry joined for ${user.email}`,
          err as Error,
        );
      }
    }

    return this.issueTokens(user);
  }

  async refresh(dto: RefreshTokenDto): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);

    const user = await this.usersService.findByIdWithRefreshToken(payload.sub);
    if (
      !user?.refreshToken ||
      user.refreshToken.expiresAt < new Date() ||
      !refreshTokenMatches(dto.refreshToken, user.refreshToken.hashedToken)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens(user);
  }

  async logout(dto: RefreshTokenDto): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.verifyRefreshToken(dto.refreshToken);
    } catch {
      return;
    }

    await this.usersService.clearRefreshToken(payload.sub);
  }

  // Fixed, never-real ObjectId used so a non-existent email gets the same
  // response shape/timing as a real one — stops enumeration via forgot-password.
  private static readonly INERT_SUBJECT = '000000000000000000000000';

  async forgotPassword(dto: ForgotPasswordDto): Promise<{
    otpToken: string;
    message: string;
    emailPreview: { subject: string; html: string };
  }> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    const message =
      'If that email is registered, a verification code has been sent.';

    if (
      !user ||
      user.authProvider !== AuthProvider.EMAIL_PHONE ||
      !user.password
    ) {
      const otp = this.passwordResetTokens.generateOtp();
      const otpToken = await this.passwordResetTokens.signOtpToken({
        sub: AuthService.INERT_SUBJECT,
        otp,
        secret: this.passwordResetSecret(),
        expiresIn: this.otpExpiry(),
        saltRounds: this.saltRounds(),
      });
      return {
        otpToken,
        message,
        emailPreview: buildOtpEmailBody('there', otp, this.otpExpiryMinutes()),
      };
    }

    const otp = this.passwordResetTokens.generateOtp();
    const otpToken = await this.passwordResetTokens.signOtpToken({
      sub: user._id.toString(),
      otp,
      secret: this.passwordResetSecret(),
      expiresIn: this.otpExpiry(),
      saltRounds: this.saltRounds(),
    });

    // Don't let a real-delivery failure (e.g. Mailtrap's demo sending
    // domain rejecting a non-account-owner recipient) block the response —
    // emailPreview below covers retrieving the OTP either way.
    try {
      await this.emailService.sendOtpEmail(
        user.email,
        user.name,
        otp,
        this.otpExpiryMinutes(),
      );
    } catch (err) {
      this.logger.warn(
        `sendOtpEmail failed, continuing since emailPreview covers it: ${(err as Error).message}`,
      );
    }

    return {
      otpToken,
      message,
      emailPreview: buildOtpEmailBody(user.name, otp, this.otpExpiryMinutes()),
    };
  }

  async resendOtp(
    dto: ResendOtpDto,
  ): Promise<{ otpToken: string; message: string }> {
    const { sub } = await this.passwordResetTokens.decodeOtpToken(
      dto.otpToken,
      this.passwordResetSecret(),
    );
    const message =
      'If that email is registered, a new verification code has been sent.';

    if (sub === AuthService.INERT_SUBJECT) {
      const otpToken = await this.passwordResetTokens.signOtpToken({
        sub: AuthService.INERT_SUBJECT,
        otp: this.passwordResetTokens.generateOtp(),
        secret: this.passwordResetSecret(),
        expiresIn: this.otpExpiry(),
        saltRounds: this.saltRounds(),
      });
      return { otpToken, message };
    }

    const user = await this.usersService.findById(sub);
    if (!user) {
      throw new BadRequestException('Invalid or expired token');
    }

    const otp = this.passwordResetTokens.generateOtp();
    const otpToken = await this.passwordResetTokens.signOtpToken({
      sub: user._id.toString(),
      otp,
      secret: this.passwordResetSecret(),
      expiresIn: this.otpExpiry(),
      saltRounds: this.saltRounds(),
    });

    await this.emailService.sendOtpEmail(
      user.email,
      user.name,
      otp,
      this.otpExpiryMinutes(),
    );

    return { otpToken, message };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ resetToken: string }> {
    const { sub } = await this.passwordResetTokens.verifyOtp(
      dto.otpToken,
      dto.otp,
      this.passwordResetSecret(),
    );

    const user = await this.usersService.findByIdWithPassword(sub);
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const resetToken = await this.passwordResetTokens.signResetToken({
      sub: user._id.toString(),
      passwordHash: user.password,
      secret: this.passwordResetSecret(),
      expiresIn: this.resetTokenExpiry(),
    });

    return { resetToken };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const unverified = this.jwtService.decode<{ sub?: string }>(dto.resetToken);
    const user = unverified?.sub
      ? await this.usersService.findByIdWithPassword(unverified.sub)
      : null;

    await this.passwordResetTokens.verifyResetToken(
      dto.resetToken,
      user?.password,
      this.passwordResetSecret(),
    );

    const password = await bcrypt.hash(dto.newPassword, this.saltRounds());
    await this.usersService.setPassword(user!._id.toString(), password);
    await this.usersService.clearRefreshToken(user!._id.toString());

    return { message: 'Password reset successfully. Please log in again.' };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user || !user.password) {
      throw new BadRequestException(
        'This account signed up with Google and has no password to change',
      );
    }

    const matches = await bcrypt.compare(dto.currentPassword, user.password);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const password = await bcrypt.hash(dto.newPassword, this.saltRounds());
    await this.usersService.setPassword(userId, password);
    await this.usersService.clearRefreshToken(userId);

    return {
      message:
        'Password changed successfully. Please log in again on other devices.',
    };
  }

  async verifyEmail(
    userId: string,
    dto: VerifyEmailDto,
  ): Promise<{ message: string }> {
    const { sub } = await this.passwordResetTokens.verifyOtp(
      dto.otpToken,
      dto.otp,
      this.passwordResetSecret(),
      'email_verify',
    );

    if (sub !== userId) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.usersService.setEmailVerified(userId);
    return { message: 'Email verified successfully.' };
  }

  async resendVerificationEmail(
    userId: string,
  ): Promise<{ otpToken?: string; message: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (user.emailVerified) {
      return { message: 'Email is already verified.' };
    }

    const { otp, otpToken } = await this.issueEmailVerificationOtp(userId);
    await this.emailService.sendOtpEmail(
      user.email,
      user.name,
      otp,
      this.otpExpiryMinutes(),
    );

    return {
      otpToken,
      message: 'A new verification code has been sent to your email.',
    };
  }

  private async issueEmailVerificationOtp(
    userId: string,
  ): Promise<{ otp: string; otpToken: string }> {
    const otp = this.passwordResetTokens.generateOtp();
    const otpToken = await this.passwordResetTokens.signOtpToken({
      sub: userId,
      otp,
      secret: this.passwordResetSecret(),
      expiresIn: this.otpExpiry(),
      saltRounds: this.saltRounds(),
      purpose: 'email_verify',
    });

    // DEV ONLY — lets you complete verify-email without Brevo configured.
    this.logger.log(
      `[DEV ONLY] Email verification OTP for user ${userId}: ${otp}`,
    );

    return { otp, otpToken };
  }

  private passwordResetSecret(): string {
    return this.config.get<string>('JWT_PASSWORD_RESET_SECRET') as string;
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

  private async verifyRefreshToken(
    token: string,
  ): Promise<RefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  // IMPLEMENTATION OF ACCESS TOKEN AND REFRESH TOKEN ISSUANCE
  private async issueTokens(user: UserDocument): Promise<TokenPair> {
    const userId = user._id.toString();

    const accessToken = await this.jwtService.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY') as StringValue,
      },
    );

    const refreshExpiresIn = this.config.get<string>(
      'JWT_REFRESH_EXPIRY',
    ) as StringValue;
    // jti makes each issued token unique — without it, two tokens signed
    // for the same user within the same second are byte-identical, which
    // breaks "the old token no longer matches" after rotation.
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, jti: randomUUID() },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiresIn,
      },
    );

    const decoded = this.jwtService.decode<{ exp: number }>(refreshToken);
    await this.usersService.setRefreshToken(userId, {
      hashedToken: hashRefreshToken(refreshToken),
      expiresAt: new Date(decoded.exp * 1000),
    });

    return {
      accessToken,
      refreshToken,
      emailVerified: user.emailVerified,
      kycStatus: user.kycStatus,
    };
  }

  private saltRounds(): number {
    return this.config.get<number>('BCRYPT_SALT_ROUNDS', 12);
  }
}
