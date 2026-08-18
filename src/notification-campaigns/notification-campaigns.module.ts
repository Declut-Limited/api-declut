import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Campaign, CampaignSchema } from './schemas/campaign.schema';
import { NotificationCampaignsService } from './notification-campaigns.service';
import { NotificationCampaignsController } from './notification-campaigns.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
    ]),
    AdminAuthModule,
    UsersModule,
    NotificationsModule,
    EmailModule,
    AuditLogModule,
  ],
  controllers: [NotificationCampaignsController],
  providers: [NotificationCampaignsService],
  exports: [NotificationCampaignsService],
})
export class NotificationCampaignsModule {}
