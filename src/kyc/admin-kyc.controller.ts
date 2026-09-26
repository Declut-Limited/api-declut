import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { KycService } from './kyc.service';
import { AdminListKycDto } from './dto/admin-list-kyc.dto';
import { SetKycStatusDto } from '../admin/dto/set-kyc-status.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

// KYC's own admin surface — moved off the general operational
// AdminController (was PATCH /admin/users/:id/kyc, gated users/write).
@Controller('admin/kyc')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminKycController {
  constructor(private readonly kycService: KycService) {}

  @Get()
  @RequirePermission('kyc', 'view')
  list(@Query() dto: AdminListKycDto) {
    return this.kycService.adminList(dto);
  }

  // Registered before ':idOrSlug' style routes aren't a concern here since
  // this is the only GET besides the bare list above.
  @Get('user/:idOrSlug')
  @RequirePermission('kyc', 'view')
  getUserDetail(@Param('idOrSlug') idOrSlug: string) {
    return this.kycService.adminGetUserDetail(idOrSlug);
  }

  @Patch('user/:idOrSlug')
  @RequirePermission('kyc', 'write')
  overrideStatus(
    @Param('idOrSlug') idOrSlug: string,
    @Body() dto: SetKycStatusDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.kycService.adminOverrideStatus(idOrSlug, dto.status, admin.sub);
  }
}
