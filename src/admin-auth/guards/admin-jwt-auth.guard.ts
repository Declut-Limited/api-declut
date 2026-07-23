import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AdminAccessTokenPayload } from '../interfaces/admin-jwt-payload.interface';

export interface AuthenticatedAdminRequest extends Request {
  admin: AdminAccessTokenPayload;
}

/**
 * The regular-user JwtAuthGuard + AdminGuard pair (verify identity, then
 * check a role flag) is gone for admin routes — this single guard replaces
 * both, since "is this a valid admin token" and "is this an admin" are now
 * the same question. It verifies against JWT_ADMIN_ACCESS_SECRET, a
 * structurally different key from the regular-user access secret, so a
 * compromised or forged user token can never pass here regardless of any
 * claim it carries.
 */
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedAdminRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<AdminAccessTokenPayload>(token, {
          secret: this.config.get<string>('JWT_ADMIN_ACCESS_SECRET'),
        });
      request.admin = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    return header.slice('Bearer '.length);
  }
}
