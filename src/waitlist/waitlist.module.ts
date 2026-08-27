import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { Waitlist, WaitlistSchema } from './schemas/waitlist.schema';
import { WaitlistService } from './waitlist.service';
import { WaitlistController } from './waitlist.controller';
import { AdminWaitlistController } from './admin-waitlist.controller';
import { WaitlistBulkInviteProcessor } from './queues/waitlist-bulk-invite.processor';
import { WAITLIST_INVITE_QUEUE } from './queues/waitlist-invite-queue.constants';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Waitlist.name, schema: WaitlistSchema },
    ]),
    BullModule.registerQueue({ name: WAITLIST_INVITE_QUEUE }),
    AdminAuthModule,
    AuditLogModule,
    EmailModule,
  ],
  controllers: [WaitlistController, AdminWaitlistController],
  providers: [WaitlistService, WaitlistBulkInviteProcessor],
  exports: [WaitlistService],
})
export class WaitlistModule {}
