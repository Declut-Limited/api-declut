import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Listing, ListingSchema } from './schemas/listing.schema';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { CategoriesModule } from '../categories/categories.module';
import { CounterModule } from '../common/counter/counter.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Listing.name, schema: ListingSchema }]),
    CloudinaryModule,
    CategoriesModule,
    NotificationsModule,
    CounterModule,
    AuditLogModule,
  ],
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
