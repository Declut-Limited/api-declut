import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { Listing, ListingSchema } from '../listings/schemas/listing.schema';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { UsersModule } from '../users/users.module';
import { CounterModule } from '../common/counter/counter.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      // Direct model injection (not ListingsModule) — ListingsModule already
      // depends on AuditLogModule, so importing it back here would cycle.
      // Same workaround CategoriesService/TrustScoreService already use.
      { name: Listing.name, schema: ListingSchema },
    ]),
    // forwardRef: NotificationsModule now imports AuditLogModule (for the
    // broadcast-delete audit log) and NotificationsModule <-> AdminAuthModule
    // is already a forwardRef cycle — without deferring this edge too, the
    // resulting 3-hop file-level require cycle resolves AdminAuthModule to
    // undefined mid-load (confirmed live: "UndefinedModuleException").
    forwardRef(() => AdminAuthModule),
    UsersModule,
    CounterModule,
  ],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
