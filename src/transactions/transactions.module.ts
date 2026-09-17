import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import {
  TransactionNote,
  TransactionNoteSchema,
} from './schemas/transaction-note.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { Payout, PayoutSchema } from './schemas/payout.schema';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { ListingsModule } from '../listings/listings.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { TrustScoreModule } from '../trust-score/trust-score.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationSettingsModule } from '../notification-settings/notification-settings.module';
import { SettingsModule } from '../settings/settings.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CounterModule } from '../common/counter/counter.module';
import { EscrowModule } from '../escrow/escrow.module';
import { BankAccountsModule } from '../bank-accounts/bank-accounts.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: TransactionNote.name, schema: TransactionNoteSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: Payout.name, schema: PayoutSchema },
    ]),
    ListingsModule,
    PaymentsModule,
    UsersModule,
    TrustScoreModule,
    NotificationsModule,
    NotificationSettingsModule,
    SettingsModule,
    AuditLogModule,
    CounterModule,
    EscrowModule,
    BankAccountsModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
