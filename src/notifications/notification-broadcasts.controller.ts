import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { NotificationsService } from './notifications.service';
import { ListNotificationBroadcastsDto } from './dto/list-notification-broadcasts.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

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

  // Must come before ':id' — otherwise Nest matches "export" as the id.
  @Get('export')
  @RequirePermission('notifications', 'view')
  async export(
    @Query() dto: ListNotificationBroadcastsDto,
    @Res() res: Response,
  ) {
    const csv = await this.notificationsService.exportBroadcastsCsv(dto.status);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="notification-broadcasts.csv"',
    );
    res.send(csv);
  }

  @Delete(':id')
  @RequirePermission('notifications', 'delete')
  async remove(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.notificationsService.removeBroadcast(id, admin.sub);
    return { removed: true };
  }
}
