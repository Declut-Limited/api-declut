import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
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
import { AuthProvider, UserDocument, UserRole } from '../users/schemas/user.schema';
import { GoogleOAuthService } from '../google/google-oauth.service';
import {
  RefreshToken,
  RefreshTokenDocument,
} from './schemas/refresh-token.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshTokenPayload } from './interfaces/jwt-payload.interface';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(RefreshToken.name)
    private refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly googleOAuth: GoogleOAuthService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds());
    const user = await this.usersService.createEmailUser({
      email: dto.email,
      name: dto.name,
      passwordHash,
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);

    // Same generic error whether the email doesn't exist, belongs to a
    // Google-only account, or the password is wrong — never tell an
    // attacker which case they hit.
    if (!user || user.authProvider !== AuthProvider.EMAIL || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const matches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user);
  }

  async googleAuth(dto: GoogleAuthDto): Promise<TokenPair> {
    let identity;
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
      const existingByEmail = await this.usersService.findByEmail(identity.email);
      if (existingByEmail) {
        // Admins are email/password-only — tell them plainly rather than
        // the generic conflict message below.
        if (existingByEmail.role === UserRole.ADMIN) {
          throw new ForbiddenException(
            'Admin accounts must sign in with email and password',
          );
        }
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

    // Defense in depth: admin accounts should never carry a googleId in the
    // first place (createGoogleUser always sets role 'user', and the check
    // above blocks linking Google to an existing admin's email), but this
    // is the last line of defense if that invariant is ever broken elsewhere.
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Admin accounts must sign in with email and password',
      );
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

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
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
      { sub: userId, role: user.role },
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
