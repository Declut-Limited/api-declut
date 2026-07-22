import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../guards/jwt-auth.guard';

/**
 * A custom param decorator — lets a controller method write
 * `@CurrentUser() user: AccessTokenPayload` instead of manually pulling
 * `request.user` off the raw Express request every time. Nest resolves it
 * per-request, the same way it resolves the built-in @Body()/@Param().
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
