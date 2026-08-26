import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { FcmService } from './fcm.service';

@Module({
  imports: [UsersModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, FcmService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
