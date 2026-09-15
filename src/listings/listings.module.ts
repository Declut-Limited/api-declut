import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Listing, ListingSchema } from './schemas/listing.schema';
import { ListingView, ListingViewSchema } from './schemas/listing-view.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { PublicListingsController } from './public-listings.controller';
import { CategoriesModule } from '../categories/categories.module';
import { CounterModule } from '../common/counter/counter.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Listing.name, schema: ListingSchema },
      { name: ListingView.name, schema: ListingViewSchema },
      // Registered directly (not via TransactionsModule, which already
      // imports ListingsModule and would cycle) — same workaround
      // UsersModule/BankAccountsModule already use for this exact pair.
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    CategoriesModule,
    NotificationsModule,
    CounterModule,
    AuditLogModule,
  ],
  controllers: [ListingsController, PublicListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
