import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuditLogService } from './audit-log.service';
import { ListActivityLogDto } from './dto/list-activity-log.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';

@Controller('admin/activity-log')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequirePermission('activity', 'view')
  list(@Query() dto: ListActivityLogDto) {
    return this.auditLogService.listWithDetails(
      dto.page ?? 1,
      dto.limit ?? 20,
      dto.entityType,
      dto,
    );
  }

  // Must come before ':id' — otherwise Nest matches "export" as the id.
  @Get('export')
  @RequirePermission('activity', 'view')
  async export(@Query() dto: ListActivityLogDto, @Res() res: Response) {
    const csv = await this.auditLogService.exportCsv(dto.entityType, dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="activity-log.csv"',
    );
    res.send(csv);
  }

  @Get(':id')
  @RequirePermission('activity', 'view')
  findById(@Param('id') id: string) {
    return this.auditLogService.findByIdWithDetails(id);
  }

  @Delete(':id')
  @RequirePermission('activity', 'delete')
  async remove(@Param('id') id: string) {
    await this.auditLogService.remove(id);
    return { removed: true };
  }
}
