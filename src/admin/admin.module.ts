import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { ListingsModule } from '../listings/listings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TrustScoreModule } from '../trust-score/trust-score.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SettingsModule } from '../settings/settings.module';
import { KycModule } from '../kyc/kyc.module';
import { EmailModule } from '../email/email.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    UsersModule,
    ListingsModule,
    TransactionsModule,
    ReviewsModule,
    TrustScoreModule,
    AdminAuthModule,
    SettingsModule,
    KycModule,
    EmailModule,
    AuditLogModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
