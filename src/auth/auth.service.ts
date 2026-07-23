import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { UsersService } from '../users/users.service';
import { AuthProvider, UserDocument } from '../users/schemas/user.schema';
import {
  GoogleIdentity,
  GoogleOAuthService,
} from '../google/google-oauth.service';
import {
  RefreshToken,
  RefreshTokenDocument,
} from './schemas/refresh-token.schema';
import { PasswordResetTokenService } from './password-reset-token.service';
import { EmailService } from '../email/email.service';
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
}

export interface RegisterResult extends TokenPair {
  otpToken: string;
  message: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(RefreshToken.name)
    private refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly googleOAuth: GoogleOAuthService,
    private readonly passwordResetTokens: PasswordResetTokenService,
    private readonly emailService: EmailService,
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

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds());
    const user = await this.usersService.createEmailUser({
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      passwordHash,
    });

    const tokens = await this.issueTokens(user);
    const { otp, otpToken } = await this.issueEmailVerificationOtp(
      user._id.toString(),
    );

    // The account is already created and tokens already issued at this
    // point — a failed/unconfigured email send (e.g. Brevo not set up in
    // this dev environment) must not turn an otherwise-successful
    // registration into a 500. Unlike forgotPassword/resendVerificationEmail
    // (whose entire job IS sending an email, so a failure there is the
    // whole story), this is a secondary side-effect of an already-completed
    // operation — swallow and log instead. The otpToken returned is still
    // valid either way (it's a signed JWT computed locally, independent of
    // delivery); the client can call resend-verification-email once email
    // is working to get a fresh code actually delivered.
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

    // Same generic error whether the identifier doesn't match anything,
    // belongs to a Google-only account, or the password is wrong — never
    // tell an attacker which case they hit.
    if (
      !user ||
      user.authProvider !== AuthProvider.EMAIL ||
      !user.passwordHash
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const matches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user);
  }

  async googleAuth(dto: GoogleAuthDto): Promise<TokenPair> {
    let identity: GoogleIdentity;
    try {
      identity = await this.googleOAuth.verifyIdToken(dto.idToken);
    } catch (err) {
      // A server misconfiguration (missing GOOGLE_CLIENT_ID) is a 500, not a
      // 401 — don't let it masquerade as "client sent a bad token."
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
        // Judgment call: if an email/password account already owns this
        // email, we don't silently merge it with the Google identity —
        // that would let anyone sign in to an existing account just by
        // controlling the same email address on Google. Reject instead.
        throw new ConflictException(
          'An account with this email already exists',
        );
      }

      user = await this.usersService.createGoogleUser({
        email: identity.email,
        name: identity.name,
        googleId: identity.googleId,
      });
    }

    return this.issueTokens(user);
  }

  async refresh(dto: RefreshTokenDto): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);

    const stored = await this.refreshTokenModel.findOne({ jti: payload.jti });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const matches = await bcrypt.compare(dto.refreshToken, stored.tokenHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotation: this refresh token is now spent. If it gets presented again
    // later, `stored.revokedAt` will be set and the request above rejects it
    // — that's the signal a token was stolen and replayed.
    stored.revokedAt = new Date();
    await stored.save();

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens(user);
  }

  async logout(dto: RefreshTokenDto): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.verifyRefreshToken(dto.refreshToken);
    } catch {
      return; // already invalid/expired — logout is idempotent either way
    }

    await this.refreshTokenModel.updateOne(
      { jti: payload.jti },
      { revokedAt: new Date() },
    );
  }

  // A fixed, never-real ObjectId used as the `sub` of an OTP token issued
  // for an email that doesn't map to a real (or password-capable) account —
  // keeps the response shape/timing identical to the real-account path so
  // POST /auth/forgot-password can't be used to enumerate registered
  // emails. Any later verify-otp attempt against it just fails the same way
  // a wrong code would.
  private static readonly INERT_SUBJECT = '000000000000000000000000';

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<{ otpToken: string; message: string }> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    const message =
      'If that email is registered, a verification code has been sent.';

    // Google-only accounts have no password to reset — silently no-op
    // (same generic response) rather than revealing that via an error.
    if (
      !user ||
      user.authProvider !== AuthProvider.EMAIL ||
      !user.passwordHash
    ) {
      const otpToken = await this.passwordResetTokens.signOtpToken({
        sub: AuthService.INERT_SUBJECT,
        otp: this.passwordResetTokens.generateOtp(),
        secret: this.passwordResetSecret(),
        expiresIn: this.otpExpiry(),
        saltRounds: this.saltRounds(),
      });
      return { otpToken, message };
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
    if (!user || !user.passwordHash) {
      // Covers both the inert-subject case and a real account that somehow
      // has no password (Google-only) — same error either way.
      throw new UnauthorizedException('Invalid or expired code');
    }

    const resetToken = await this.passwordResetTokens.signResetToken({
      sub: user._id.toString(),
      passwordHash: user.passwordHash,
      secret: this.passwordResetSecret(),
      expiresIn: this.resetTokenExpiry(),
    });

    return { resetToken };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    // Deliberately re-decode without verifying the fingerprint first, just
    // to get `sub` — verifyResetToken (below) does the real fingerprint
    // check against a freshly-read passwordHash, which is what makes this
    // token single-use with no DB storage of the token itself.
    const unverified = this.jwtService.decode<{ sub?: string }>(dto.resetToken);
    const user = unverified?.sub
      ? await this.usersService.findByIdWithPassword(unverified.sub)
      : null;

    await this.passwordResetTokens.verifyResetToken(
      dto.resetToken,
      user?.passwordHash,
      this.passwordResetSecret(),
    );

    // user is guaranteed non-null here — verifyResetToken throws otherwise
    // (a null passwordHash can never match a fingerprint).
    const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds());
    await this.usersService.setPasswordHash(user!._id.toString(), passwordHash);
    await this.revokeAllRefreshTokens(user!._id.toString());

    return { message: 'Password reset successfully. Please log in again.' };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user || !user.passwordHash) {
      throw new BadRequestException(
        'This account signed up with Google and has no password to change',
      );
    }

    const matches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds());
    await this.usersService.setPasswordHash(userId, passwordHash);
    await this.revokeAllRefreshTokens(userId);

    return {
      message:
        'Password changed successfully. Please log in again on other devices.',
    };
  }

  // Authenticated (JwtAuthGuard) rather than the stateless email-lookup
  // pattern forgot-password uses — the caller already has a valid access
  // token from register()/login(), so there's no enumeration concern to
  // guard against and no need to re-identify the user by email.
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

    // The otpToken must belong to the same account as the caller's access
    // token — stops one account's (otpToken, otp) pair, if leaked, from
    // verifying a different account's email.
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
    // Unlike register()'s auto-send, resend's entire job IS sending the
    // email — same critical-path posture as forgotPassword/resendOtp, so a
    // failure here propagates as a 500 rather than being swallowed.
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

  // Pure/local — generates the OTP and signs its carrying token, no network
  // call. Callers decide separately whether an email-send failure should
  // propagate (resend) or be swallowed (register, see the comment there).
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
    return { otp, otpToken };
  }

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.refreshTokenModel.updateMany(
      { user: userId, revokedAt: { $exists: false } },
      { revokedAt: new Date() },
    );
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

  private async issueTokens(user: UserDocument): Promise<TokenPair> {
    const userId = user._id.toString();

    const accessToken = await this.jwtService.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY') as StringValue,
      },
    );

    const jti = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, jti },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRY') as StringValue,
      },
    );

    const decoded = this.jwtService.decode<{ exp: number }>(refreshToken);
    const tokenHash = await bcrypt.hash(refreshToken, this.saltRounds());

    await this.refreshTokenModel.create({
      user: user._id,
      jti,
      tokenHash,
      expiresAt: new Date(decoded.exp * 1000),
    });

    return { accessToken, refreshToken };
  }

  private saltRounds(): number {
    return this.config.get<number>('BCRYPT_SALT_ROUNDS', 12);
  }
}
