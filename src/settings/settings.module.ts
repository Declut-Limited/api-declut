import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppSettings, AppSettingsSchema } from './schemas/app-settings.schema';
import { SettingsService } from './settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppSettings.name, schema: AppSettingsSchema },
    ]),
  ],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
