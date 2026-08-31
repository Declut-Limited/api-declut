import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from './schemas/category.schema';
import { Listing, ListingSchema } from '../listings/schemas/listing.schema';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { PublicCategoriesController } from './public-categories.controller';
import { UserCategoriesController } from './user-categories.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: Listing.name, schema: ListingSchema },
    ]),
    AdminAuthModule,
  ],
  controllers: [
    CategoriesController,
    PublicCategoriesController,
    UserCategoriesController,
  ],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
