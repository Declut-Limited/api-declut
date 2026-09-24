import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { CreateReferralCampaignDto } from './dto/create-referral-campaign.dto';
import { UpdateReferralCampaignDto } from './dto/update-referral-campaign.dto';
import { ListReferralCampaignsDto } from './dto/list-referral-campaigns.dto';
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

  // Must come after the bare list route above — no conflict here since
  // there's no other static segment under this controller, but kept last
  // for consistency with every other admin resource's route ordering.
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
}
