import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Admin, AdminSchema } from '../admin-auth/schemas/admin.schema';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import {
  NotificationBroadcast,
  NotificationBroadcastSchema,
} from './schemas/notification-broadcast.schema';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsController } from './notifications.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { NotificationBroadcastsController } from './notification-broadcasts.controller';
import { NotificationBroadcastProcessor } from './queues/notification-broadcast.processor';
import { BROADCAST_QUEUE } from './queues/broadcast-queue.constants';
import { FcmService } from './fcm.service';
// forwardRef with AdminAuthModule: this module needs PermissionsGuard (which needs AdminAuthService) for NotificationBroadcastsController, and AdminAuthModule needs NotificationsService for the role-updated notification and the logout socket-disconnect — a genuine two-way dependency, not one the usual "register the schema directly" workaround covers, since guards need real DI-resolved services, not just a raw model.
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationBroadcast.name, schema: NotificationBroadcastSchema },
      // Registered directly (not via UsersModule/AdminAuthModule) — same workaround CategoriesService/TrustScoreService/AuditLogService already use — needed here for the bulk-broadcast processor's cursor.
      { name: User.name, schema: UserSchema },
      { name: Admin.name, schema: AdminSchema },
    ]),
    BullModule.registerQueue({ name: BROADCAST_QUEUE }),
    UsersModule,
    EmailModule,
    forwardRef(() => AdminAuthModule),
  ],
  controllers: [
    NotificationsController,
    AdminNotificationsController,
    NotificationBroadcastsController,
  ],
  providers: [
    NotificationsService,
    NotificationsGateway,
    FcmService,
    NotificationBroadcastProcessor,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
