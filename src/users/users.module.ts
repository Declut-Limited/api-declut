import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema';
import { Listing, ListingSchema } from '../listings/schemas/listing.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CounterModule } from '../common/counter/counter.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      // Registered directly (not via TransactionsModule/ListingsModule) —
      // same cycle-avoidance workaround CategoriesService/TrustScoreService/
      // AuditLogService already use — needed for /users/me's listing/sale/
      // purchase/escrow stats.
      { name: Transaction.name, schema: TransactionSchema },
      { name: Listing.name, schema: ListingSchema },
    ]),
    CounterModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
