import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';
import { NotificationRecipientType } from './schemas/notification.schema';

// An admin's own inbox — like /admin/auth/me, deliberately NOT gated by PermissionsGuard, since reading your own notifications isn't module-permission-gated.
@Controller('admin/notifications')
@UseGuards(AdminJwtAuthGuard)
export class AdminNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Query() dto: ListNotificationsDto,
  ) {
    return this.notificationsService.listForRecipient(
      NotificationRecipientType.ADMIN,
      admin.sub,
      dto.page ?? 1,
      dto.limit ?? 20,
    );
  }

  @Patch(':id/read')
  async markRead(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.notificationsService.markRead(
      NotificationRecipientType.ADMIN,
      admin.sub,
      id,
    );
    return { read: true };
  }
}
