import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { ListingsModule } from '../listings/listings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { OffersModule } from '../offers/offers.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TrustScoreModule } from '../trust-score/trust-score.module';

@Module({
  imports: [
    UsersModule,
    ListingsModule,
    TransactionsModule,
    OffersModule,
    ReviewsModule,
    TrustScoreModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
