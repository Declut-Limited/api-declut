import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedAdminRequest } from '../guards/admin-jwt-auth.guard';

// Mirrors CurrentUser but reads `request.admin` (set by AdminJwtAuthGuard)
// instead of `request.user` — the two identity spaces are kept structurally
// separate end to end, not just at the guard level.
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedAdminRequest>();
    return request.admin;
  },
);
