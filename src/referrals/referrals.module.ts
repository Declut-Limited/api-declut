import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ReferralCampaign,
  ReferralCampaignSchema,
} from './schemas/referral-campaign.schema';
import { Participant, ParticipantSchema } from './schemas/participant.schema';
import { Referral, ReferralSchema } from './schemas/referral.schema';
import { Reward, RewardSchema } from './schemas/reward.schema';
import { ReferralsService } from './referrals.service';
import { AdminReferralCampaignsController } from './admin-referral-campaigns.controller';
import { UserReferralCampaignsController } from './user-referral-campaigns.controller';
import { AdminReferralParticipantsController } from './admin-referral-participants.controller';
import { AdminReferralRewardsController } from './admin-referral-rewards.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { Listing, ListingSchema } from '../listings/schemas/listing.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { CounterModule } from '../common/counter/counter.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReferralCampaign.name, schema: ReferralCampaignSchema },
      { name: Participant.name, schema: ParticipantSchema },
      { name: Referral.name, schema: ReferralSchema },
      { name: Reward.name, schema: RewardSchema },
      { name: User.name, schema: UserSchema },
      // Registered directly (not a TransactionsModule import, to avoid ever
      // risking a cycle) — read-only, backs the participant detail's
      // "referred users' own real transactions" sub-table. Same workaround
      // Listings/Users/BankAccounts already use for this exact pair.
      { name: Transaction.name, schema: TransactionSchema },
      // Read-only — backs evaluateReferralProgress()'s validationRules.notFlagged
      // check (was the referred user's listing ever reported). Same
      // avoid-a-cycle workaround as Transaction/User above.
      { name: Listing.name, schema: ListingSchema },
    ]),
    AdminAuthModule,
    AuditLogModule,
    NotificationsModule,
    CounterModule,
  ],
  controllers: [
    AdminReferralCampaignsController,
    UserReferralCampaignsController,
    AdminReferralParticipantsController,
    AdminReferralRewardsController,
  ],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
