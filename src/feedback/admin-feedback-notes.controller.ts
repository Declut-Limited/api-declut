import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackNoteDto } from './dto/create-feedback-note.dto';
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
}
