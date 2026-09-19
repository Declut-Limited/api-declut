import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { FeedbackService } from './feedback.service';
import { ListAdminFeedbackDto } from './dto/list-admin-feedback.dto';
import { FeedbackAnalyticsDto } from './dto/feedback-analytics.dto';
import { UpdateFeedbackStatusDto } from './dto/update-feedback-status.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin/feedback')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminFeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  @RequirePermission('feedback', 'view')
  list(@Query() dto: ListAdminFeedbackDto) {
    return this.feedbackService.adminList(dto);
  }

  @Get('analytics')
  @RequirePermission('feedback', 'view')
  analytics(@Query() dto: FeedbackAnalyticsDto) {
    return this.feedbackService.getAnalytics(
      dto.period ?? 'thisMonth',
      dto.startDate,
      dto.endDate,
    );
  }

  @Get('recent-attention')
  @RequirePermission('feedback', 'view')
  recentAttention() {
    return this.feedbackService.getRecentAttention();
  }

  // Must come before ':idOrSlug' below — otherwise Nest matches "export" as
  // the idOrSlug, same hazard as every other export in this app.
  @Get('export')
  @RequirePermission('feedback', 'view')
  async export(@Query() dto: ListAdminFeedbackDto, @Res() res: Response) {
    const csv = await this.feedbackService.exportCsv(dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="feedback.csv"');
    res.send(csv);
  }

  // Must come after the static routes above — otherwise Nest would match
  // "analytics"/"recent-attention"/"export" as :idOrSlug, same hazard this
  // codebase's other "static route before dynamic param" cases document.
  @Get(':idOrSlug')
  @RequirePermission('feedback', 'view')
  findOne(@Param('idOrSlug') idOrSlug: string) {
    return this.feedbackService.adminFindByIdOrSlug(idOrSlug);
  }

  @Patch(':id/status')
  @RequirePermission('feedback', 'write')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackStatusDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.feedbackService.updateStatus(id, admin.sub, dto);
  }
}
