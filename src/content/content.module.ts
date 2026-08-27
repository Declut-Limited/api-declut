import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Content, ContentSchema } from './schemas/content.schema';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CounterModule } from '../common/counter/counter.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Content.name, schema: ContentSchema }]),
    AdminAuthModule,
    CounterModule,
    AuditLogModule,
    NotificationsModule,
  ],
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
