import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BankAccount, BankAccountSchema } from './schemas/bank-account.schema';
import { BankAccountsService } from './bank-accounts.service';
import { BankAccountsController } from './bank-accounts.controller';
import { BanksController } from './banks.controller';
import { PaymentsModule } from '../payments/payments.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BankAccount.name, schema: BankAccountSchema },
    ]),
    PaymentsModule,
    AuditLogModule,
  ],
  controllers: [BankAccountsController, BanksController],
  providers: [BankAccountsService],
  exports: [BankAccountsService],
})
export class BankAccountsModule {}
