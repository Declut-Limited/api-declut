import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '../../users/schemas/user.schema';
import { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Layers on top of JwtAuthGuard (apply both: @UseGuards(JwtAuthGuard,
 * AdminGuard)) — JwtAuthGuard confirms *who* the request is, this confirms
 * they're allowed to hit an admin-only route. Being logged in is not being
 * an admin, per CLAUDE.md's security requirements.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
