import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService } from '../admin-auth.service';
import {
  REQUIRE_PERMISSION_KEY,
  RequiredPermission,
} from '../decorators/require-permission.decorator';
import { AuthenticatedAdminRequest } from './admin-jwt-auth.guard';

// Runs after AdminJwtAuthGuard. Looks the admin up fresh on every request
// rather than trusting permissions baked into the JWT — this codebase
// already hit the staleness problem once with a role claim (see CLAUDE.md);
// a revoked permission should take effect immediately, not after the
// access token expires.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminAuthService: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<RequiredPermission>(
      REQUIRE_PERMISSION_KEY,
      context.getHandler(),
    );
    if (!required) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedAdminRequest>();
    const admin = await this.adminAuthService.findById(request.admin.sub);
    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    const allowed = admin.permissions?.[required.module]?.[required.action];
    if (!allowed) {
      throw new ForbiddenException(
        `Missing ${required.action} permission for ${required.module}`,
      );
    }
    return true;
  }
}
