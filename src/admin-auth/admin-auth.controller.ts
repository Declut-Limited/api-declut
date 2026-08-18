import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { CreateSubAdminDto } from './dto/create-sub-admin.dto';
import { AdminRefreshTokenDto } from './dto/admin-refresh-token.dto';
import { AdminForgotPasswordDto } from './dto/admin-forgot-password.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import { UpdateAdminPermissionsDto } from './dto/update-admin-permissions.dto';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from './interfaces/admin-jwt-payload.interface';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const RESET_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuthService.login(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: AdminRefreshTokenDto) {
    return this.adminAuthService.refresh(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Body() dto: AdminRefreshTokenDto) {
    await this.adminAuthService.logout(dto);
    return { loggedOut: true };
  }

  @Throttle(RESET_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: AdminForgotPasswordDto) {
    return this.adminAuthService.forgotPassword(dto);
  }

  @Throttle(RESET_THROTTLE)
  @Get('verify-reset-token/:token')
  verifyResetToken(@Param('token') token: string) {
    return this.adminAuthService.verifyResetToken(token);
  }

  @Throttle(RESET_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password/:token')
  resetPassword(
    @Param('token') token: string,
    @Body() dto: AdminResetPasswordDto,
  ) {
    return this.adminAuthService.resetPassword(token, dto);
  }

  @UseGuards(AdminJwtAuthGuard)
  @Get('me')
  getMe(@CurrentAdmin() admin: AdminAccessTokenPayload) {
    return this.adminAuthService.getProfile(admin.sub);
  }

  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Patch('change-password')
  changePassword(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: AdminChangePasswordDto,
  ) {
    return this.adminAuthService.changePassword(admin.sub, dto);
  }

  // Any authenticated admin can create another admin — the permissions the
  // new admin gets are whatever's in the request body (see RBAC), not
  // inherited from the creator.
  @UseGuards(AdminJwtAuthGuard)
  @Post('sub-admins')
  createSubAdmin(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: CreateSubAdminDto,
  ) {
    return this.adminAuthService.createSubAdmin(admin.sub, dto);
  }

  // Partial patch of an existing admin's permissions — separate from
  // creation since it merges into what's already there instead of
  // resetting every omitted module/action to false.
  @UseGuards(AdminJwtAuthGuard)
  @Patch('sub-admins/:id/permissions')
  updatePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateAdminPermissionsDto,
  ) {
    return this.adminAuthService.updatePermissions(id, dto);
  }
}
