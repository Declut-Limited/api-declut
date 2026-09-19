import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Report, ReportSchema } from './schemas/report.schema';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { UserReportsController } from './user-reports.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CounterModule } from '../common/counter/counter.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ListingsModule } from '../listings/listings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
    AdminAuthModule,
    CounterModule,
    AuditLogModule,
    NotificationsModule,
    ListingsModule,
    TransactionsModule,
    SettingsModule,
  ],
  controllers: [ReportsController, UserReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
