import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { ListAdminFeedbackDto } from './dto/list-admin-feedback.dto';
import { FeedbackAnalyticsDto } from './dto/feedback-analytics.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';

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
}
