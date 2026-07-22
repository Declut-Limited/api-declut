import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AccessTokenPayload } from '../interfaces/jwt-payload.interface';

export interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
}

/**
 * A Guard is Nest's dedicated hook for "should this request be allowed to
 * reach the handler at all" — it runs before pipes/interceptors/the route
 * method, and returning false (or throwing) short-circuits the request. This
 * is the general-purpose auth check: apply with @UseGuards(JwtAuthGuard) on
 * any controller/route that requires a logged-in user of either role.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        { secret: this.config.get<string>('JWT_ACCESS_SECRET') },
      );
      request.user = payload;
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
