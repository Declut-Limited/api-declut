import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Listing, ListingSchema } from './schemas/listing.schema';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Listing.name, schema: ListingSchema }]),
    CloudinaryModule,
    SettingsModule,
  ],
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
