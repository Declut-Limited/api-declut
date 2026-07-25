import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { FcmService } from './fcm.service';
import { AdminNotificationsGateway } from './admin-notifications.gateway';

@Module({
  imports: [UsersModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, FcmService, AdminNotificationsGateway],
  exports: [NotificationsService],
})
export class NotificationsModule {}
