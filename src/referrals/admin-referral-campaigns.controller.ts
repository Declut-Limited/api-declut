import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReferralsService } from './referrals.service';
import { CreateReferralCampaignDto } from './dto/create-referral-campaign.dto';
import { UpdateReferralCampaignDto } from './dto/update-referral-campaign.dto';
import { ListReferralCampaignsDto } from './dto/list-referral-campaigns.dto';
import { ReferralAnalyticsDto } from './dto/referral-analytics.dto';
import { ReferralDashboardDto } from './dto/referral-dashboard.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin/referral-campaigns')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminReferralCampaignsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Post()
  @RequirePermission('referrals', 'write')
  create(
    @Body() dto: CreateReferralCampaignDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.referralsService.create(dto, admin.sub);
  }

  @Get()
  @RequirePermission('referrals', 'view')
  list(@Query() dto: ListReferralCampaignsDto) {
    return this.referralsService.list(dto);
  }

  // Must come before ':id' below — otherwise Nest would match the literal
  // segment "analytics" as the id param, same hazard documented throughout
  // this codebase (users/export, listings/by-user, ...).
  @Get('analytics')
  @RequirePermission('referrals', 'view')
  analytics(@Query() dto: ReferralAnalyticsDto) {
    return this.referralsService.getAnalytics(
      dto.period ?? 'thisMonth',
      dto.startDate,
      dto.endDate,
    );
  }

  // Must come before ':id' below, same hazard as 'analytics' above.
  @Get('dashboard')
  @RequirePermission('referrals', 'view')
  dashboard(@Query() dto: ReferralDashboardDto) {
    return this.referralsService.getDashboard(dto.year, dto.allTime);
  }

  // Must come before ':id' below, same hazard as 'analytics'/'dashboard'.
  @Get('export')
  @RequirePermission('referrals', 'view')
  async export(@Query() dto: ListReferralCampaignsDto, @Res() res: Response) {
    const csv = await this.referralsService.exportCampaignsCsv(dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="referral-campaigns.csv"',
    );
    res.send(csv);
  }

  @Get(':id')
  @RequirePermission('referrals', 'view')
  findById(@Param('id') id: string) {
    return this.referralsService.findById(id);
  }

  @Patch(':id')
  @RequirePermission('referrals', 'write')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReferralCampaignDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.referralsService.update(id, dto, admin.sub);
  }

  @Post(':id/duplicate')
  @RequirePermission('referrals', 'write')
  duplicate(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.referralsService.duplicate(id, admin.sub);
  }

  @Patch(':id/archive')
  @RequirePermission('referrals', 'write')
  archive(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.referralsService.archive(id, admin.sub);
  }
}
