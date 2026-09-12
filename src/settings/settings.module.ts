import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppSettings, AppSettingsSchema } from './schemas/app-settings.schema';
import { SettingsService } from './settings.service';
import { PublicSettingsController } from './public-settings.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppSettings.name, schema: AppSettingsSchema },
    ]),
  ],
  controllers: [PublicSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
