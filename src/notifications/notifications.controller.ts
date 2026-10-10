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
import { NotificationsService } from './notifications.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { NotificationRecipientType } from './schemas/notification.schema';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-token')
  async registerToken(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    await this.notificationsService.registerToken(user.sub, dto.token);
    return { registered: true };
  }

  @Get()
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() dto: ListNotificationsDto,
  ) {
    return this.notificationsService.listForUser(
      user.sub,
      dto.page ?? 1,
      dto.limit ?? 20,
      dto.read,
    );
  }

  @Get('count')
  async getUnreadCount(@CurrentUser() user: AccessTokenPayload) {
    const unreadCount = await this.notificationsService.getUnreadCount(
      NotificationRecipientType.USER,
      user.sub,
    );
    return { unreadCount };
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AccessTokenPayload) {
    const updated = await this.notificationsService.markAllRead(
      NotificationRecipientType.USER,
      user.sub,
    );
    return { updated };
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.notificationsService.markRead(
      NotificationRecipientType.USER,
      user.sub,
      id,
    );
    return { read: true };
  }

  @Patch(':id/unread')
  async markUnread(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.notificationsService.markUnread(
      NotificationRecipientType.USER,
      user.sub,
      id,
    );
    return { read: false };
  }

  // Hides it from the caller's list — see NotificationsService.hideForRecipient().
  @Delete(':id')
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.notificationsService.hideForRecipient(
      NotificationRecipientType.USER,
      user.sub,
      id,
    );
    return { deleted: true };
  }
}
