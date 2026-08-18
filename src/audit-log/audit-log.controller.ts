import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
    return this.auditLogService.list(
      dto.page ?? 1,
      dto.limit ?? 20,
      dto.entityType,
    );
  }

  @Get(':id')
  @RequirePermission('activity', 'view')
  findById(@Param('id') id: string) {
    return this.auditLogService.findById(id);
  }
}
