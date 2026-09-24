import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ReferralCampaign,
  ReferralCampaignSchema,
} from './schemas/referral-campaign.schema';
import { ReferralsService } from './referrals.service';
import { AdminReferralCampaignsController } from './admin-referral-campaigns.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReferralCampaign.name, schema: ReferralCampaignSchema },
    ]),
    AdminAuthModule,
    AuditLogModule,
  ],
  controllers: [AdminReferralCampaignsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
