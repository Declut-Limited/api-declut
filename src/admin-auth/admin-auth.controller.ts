import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { AdminResendOtpDto } from './dto/admin-resend-otp.dto';
import { AdminVerifyOtpDto } from './dto/admin-verify-otp.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from './interfaces/admin-jwt-payload.interface';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const OTP_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

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

  @Throttle(OTP_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: AdminForgotPasswordDto) {
    return this.adminAuthService.forgotPassword(dto);
  }

  @Throttle(OTP_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('resend-otp')
  resendOtp(@Body() dto: AdminResendOtpDto) {
    return this.adminAuthService.resendOtp(dto);
  }

  @Throttle(OTP_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('verify-otp')
  verifyOtp(@Body() dto: AdminVerifyOtpDto) {
    return this.adminAuthService.verifyOtp(dto);
  }

  @Throttle(OTP_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() dto: AdminResetPasswordDto) {
    return this.adminAuthService.resetPassword(dto);
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

  // Any authenticated admin can create another admin — flat permissions,
  // no RBAC tiers, per CLAUDE.md's existing "user/admin only, not the
  // PRD's full RBAC matrix" scope decision.
  @UseGuards(AdminJwtAuthGuard)
  @Post('sub-admins')
  createSubAdmin(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: CreateSubAdminDto,
  ) {
    return this.adminAuthService.createSubAdmin(admin.sub, dto);
  }
}
