import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import {
  TransactionNote,
  TransactionNoteSchema,
} from './schemas/transaction-note.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { Payout, PayoutSchema } from './schemas/payout.schema';
import { Admin, AdminSchema } from '../admin-auth/schemas/admin.schema';
import { Report, ReportSchema } from '../reports/schemas/report.schema';
import { Dispute, DisputeSchema } from '../disputes/schemas/dispute.schema';
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
      // Registered directly rather than importing AdminAuthModule/
      // ReportsModule/DisputesModule, which would cycle (ReportsModule and
      // DisputesModule both already import TransactionsModule) — same
      // raw-schema-registration workaround UsersModule/ListingsModule use
      // elsewhere in this app. Narrow, read-only-ish access: resolving a
      // Payout/Refund's triggeredBy admin (name/slug/role), and closing the
      // Report tied to a resolved dispute. 2026-09-17.
      { name: Admin.name, schema: AdminSchema },
      { name: Report.name, schema: ReportSchema },
      { name: Dispute.name, schema: DisputeSchema },
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
