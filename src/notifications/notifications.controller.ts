import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-token')
  async registerToken(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    await this.notificationsService.registerToken(user.sub, dto.token, dto.platform);
    return { registered: true };
  }

  @Delete('token/:token')
  async unregisterToken(
    @CurrentUser() user: AccessTokenPayload,
    @Param('token') token: string,
  ) {
    await this.notificationsService.unregisterToken(user.sub, token);
    return { unregistered: true };
  }
}
