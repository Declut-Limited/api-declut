import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin/reports')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @RequirePermission('reports', 'view')
  list(@Query() dto: ListReportsDto) {
    return this.reportsService.list(dto);
  }

  @Post()
  @RequirePermission('reports', 'write')
  create(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.create(admin.sub, dto);
  }

  @Get(':slug')
  @RequirePermission('reports', 'view')
  findBySlug(@Param('slug') slug: string) {
    return this.reportsService.findBySlug(slug);
  }

  @Patch(':id/status')
  @RequirePermission('reports', 'write')
  updateStatus(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateReportStatusDto,
  ) {
    return this.reportsService.updateStatus(id, admin.sub, dto.status);
  }
}
