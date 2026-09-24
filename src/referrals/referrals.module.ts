import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ReferralCampaign,
  ReferralCampaignSchema,
} from './schemas/referral-campaign.schema';
import { Participant, ParticipantSchema } from './schemas/participant.schema';
import { ReferralsService } from './referrals.service';
import { AdminReferralCampaignsController } from './admin-referral-campaigns.controller';
import { UserReferralCampaignsController } from './user-referral-campaigns.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReferralCampaign.name, schema: ReferralCampaignSchema },
      { name: Participant.name, schema: ParticipantSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AdminAuthModule,
    AuditLogModule,
    NotificationsModule,
  ],
  controllers: [
    AdminReferralCampaignsController,
    UserReferralCampaignsController,
  ],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
