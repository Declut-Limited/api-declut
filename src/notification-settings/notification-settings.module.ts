import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  NotificationSetting,
  NotificationSettingSchema,
} from './schemas/notification-setting.schema';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationSettingsController } from './notification-settings.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NotificationSetting.name, schema: NotificationSettingSchema },
    ]),
  ],
  controllers: [NotificationSettingsController],
  providers: [NotificationSettingsService],
  exports: [NotificationSettingsService],
})
export class NotificationSettingsModule {}
