import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { ListingsModule } from '../listings/listings.module';
import { OffersModule } from '../offers/offers.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { TrustScoreModule } from '../trust-score/trust-score.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    ListingsModule,
    OffersModule,
    PaymentsModule,
    UsersModule,
    TrustScoreModule,
    NotificationsModule,
    SettingsModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
