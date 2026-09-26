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
    return this.notificationsService.listForRecipient(
      NotificationRecipientType.USER,
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
}
