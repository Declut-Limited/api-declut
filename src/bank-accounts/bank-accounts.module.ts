import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BankAccount, BankAccountSchema } from './schemas/bank-account.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { BankAccountsService } from './bank-accounts.service';
import { NigerianBanksService } from './nigerian-banks.service';
import { BankAccountsController } from './bank-accounts.controller';
import { BanksController } from './banks.controller';
import { PaymentsModule } from '../payments/payments.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BankAccount.name, schema: BankAccountSchema },
      // Registered directly (not via TransactionsModule, which already
      // imports this module and would cycle) — same workaround
      // UsersModule/CategoriesService/TrustScoreService use. Only needed
      // for remove()'s in-flight-transaction check.
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    PaymentsModule,
    AuditLogModule,
    UsersModule,
  ],
  controllers: [BankAccountsController, BanksController],
  providers: [BankAccountsService, NigerianBanksService],
  exports: [BankAccountsService],
})
export class BankAccountsModule {}
