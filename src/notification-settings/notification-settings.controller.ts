import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { NotificationSettingsService } from './notification-settings.service';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('notification-settings')
@UseGuards(JwtAuthGuard)
export class NotificationSettingsController {
  constructor(
    private readonly notificationSettingsService: NotificationSettingsService,
  ) {}

  @Get('user/:userId')
  getForUser(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId') userId: string,
  ) {
    return this.notificationSettingsService.getForUser(user.sub, userId);
  }

  @Patch('user/:userId')
  updateForUser(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId') userId: string,
    @Body() dto: UpdateNotificationSettingDto,
  ) {
    return this.notificationSettingsService.updateForUser(
      user.sub,
      userId,
      dto,
    );
  }
}
