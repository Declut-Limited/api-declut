import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ListNotificationBroadcastsDto } from './dto/list-notification-broadcasts.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';

// The admin-facing broadcast log table — platform-wide oversight data, so unlike AdminNotificationsController this IS gated by PermissionsGuard, reusing the dormant `notifications` RBAC bucket.
@Controller('admin/notification-broadcasts')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class NotificationBroadcastsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @RequirePermission('notifications', 'view')
  list(@Query() dto: ListNotificationBroadcastsDto) {
    return this.notificationsService.listBroadcasts(
      dto.page ?? 1,
      dto.limit ?? 20,
      dto.status,
    );
  }
}
