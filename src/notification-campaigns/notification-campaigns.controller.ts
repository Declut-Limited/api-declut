import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationCampaignsService } from './notification-campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin/notification-campaigns')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class NotificationCampaignsController {
  constructor(
    private readonly campaignsService: NotificationCampaignsService,
  ) {}

  // Must come before ':id' — same route-ordering hazard as 'users/export'.
  @Get('automation-rules')
  @RequirePermission('notifications', 'view')
  getAutomationRules() {
    return this.campaignsService.getAutomationRules();
  }

  @Get()
  @RequirePermission('notifications', 'view')
  list(@Query() dto: ListCampaignsDto) {
    return this.campaignsService.list(dto);
  }

  @Post()
  @RequirePermission('notifications', 'write')
  create(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaignsService.create(admin.sub, dto);
  }

  @Get(':id')
  @RequirePermission('notifications', 'view')
  findById(@Param('id') id: string) {
    return this.campaignsService.findById(id);
  }

  @Patch(':id')
  @RequirePermission('notifications', 'write')
  update(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.update(id, admin.sub, dto);
  }

  @Patch(':id/send')
  @RequirePermission('notifications', 'write')
  send(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.campaignsService.send(id, admin.sub);
  }

  @Delete(':id')
  @RequirePermission('notifications', 'delete')
  async remove(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.campaignsService.remove(id, admin.sub);
    return { removed: true };
  }
}
