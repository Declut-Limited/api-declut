import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackNoteDto } from './dto/create-feedback-note.dto';
import { UpdateFeedbackNoteDto } from './dto/update-feedback-note.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

// Flat sibling of admin/feedback, mirroring admin/transaction-notes'
// flat-route-next-to-its-parent-resource shape.
@Controller('admin/feedback-notes')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminFeedbackNotesController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @RequirePermission('feedback', 'write')
  create(
    @Body() dto: CreateFeedbackNoteDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.feedbackService.createNote(
      dto.feedbackId,
      admin.sub,
      dto.description,
    );
  }

  // Only the admin who wrote the note can edit it (403 otherwise) — enforced
  // in FeedbackService.updateNote(), not just the write permission here.
  @Patch(':id')
  @RequirePermission('feedback', 'write')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackNoteDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.feedbackService.updateNote(id, admin.sub, dto.description);
  }

  // Only the admin who wrote the note can remove it (403 otherwise) — same
  // ownership check as update().
  @Delete(':id')
  @RequirePermission('feedback', 'delete')
  remove(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.feedbackService.removeNote(id, admin.sub);
  }
}
