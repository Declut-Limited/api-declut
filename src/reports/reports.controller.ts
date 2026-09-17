import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { ListReportsDto } from './dto/list-reports.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
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

  // Must come before ':slug' — otherwise Nest matches "export" as the slug.
  @Get('export')
  @RequirePermission('reports', 'view')
  async export(@Query() dto: ListReportsDto, @Res() res: Response) {
    const csv = await this.reportsService.exportCsv(dto.status, dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="reports.csv"');
    res.send(csv);
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

  // Three ways to resolve a report whose transaction reached DISPUTED — see
  // ReportsService for what each actually does. Moved here from
  // /admin/transactions (explicit instruction, 2026-09-17) — this resolves
  // the report, using its own stored `transaction` reference, not the other
  // way around.
  @Post(':id/resolve/release')
  @RequirePermission('reports', 'write')
  resolveRelease(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.reportsService.resolveRelease(id, admin.sub);
  }

  @Post(':id/resolve/refund')
  @RequirePermission('reports', 'write')
  resolveRefund(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.reportsService.resolveRefund(id, admin.sub, dto.reason);
  }

  @Post(':id/resolve/delist-and-refund')
  @RequirePermission('reports', 'write')
  resolveDelistAndRefund(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.reportsService.resolveDelistAndRefund(
      id,
      admin.sub,
      dto.reason,
    );
  }
}
