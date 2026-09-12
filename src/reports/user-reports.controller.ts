import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

// User-facing report creation — replaces the old admin-only POST
// /admin/reports (removed, since admins no longer create reports).
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class UserReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.create(user.sub, dto);
  }
}
