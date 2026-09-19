import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Feedback, FeedbackSchema } from './schemas/feedback.schema';
import {
  FeedbackNote,
  FeedbackNoteSchema,
} from './schemas/feedback-note.schema';
import { Listing, ListingSchema } from '../listings/schemas/listing.schema';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { AdminFeedbackController } from './admin-feedback.controller';
import { AdminFeedbackNotesController } from './admin-feedback-notes.controller';
import { CounterModule } from '../common/counter/counter.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Feedback.name, schema: FeedbackSchema },
      { name: FeedbackNote.name, schema: FeedbackNoteSchema },
      // Direct model registration (not ListingsModule) — just needs a
      // countDocuments for the detail view's user.listingCount, same
      // avoid-a-whole-module-import-for-one-query pattern AuditLogModule
      // already uses for the same field.
      { name: Listing.name, schema: ListingSchema },
    ]),
    CounterModule,
    AdminAuthModule,
    AuditLogModule,
  ],
  controllers: [
    FeedbackController,
    AdminFeedbackController,
    AdminFeedbackNotesController,
  ],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
