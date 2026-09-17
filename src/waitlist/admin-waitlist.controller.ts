import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { WaitlistService } from './waitlist.service';
import { ListWaitlistDto } from './dto/list-waitlist.dto';
import { InviteWaitlistDto } from './dto/invite-waitlist.dto';
import { BulkInviteWaitlistDto } from './dto/bulk-invite-waitlist.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

// PermissionsGuard added 2026-09-17, explicit instruction — this used to be
// AdminJwtAuthGuard-only (any authenticated admin, no RBAC), reversing an
// earlier explicit instruction not to gate waitlist on permissions at all.
@Controller('admin/waitlist')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminWaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Get()
  @RequirePermission('waitlist', 'view')
  list(@Query() dto: ListWaitlistDto) {
    return this.waitlistService.list(dto);
  }

  @Get('insights')
  @RequirePermission('waitlist', 'view')
  getInsights() {
    return this.waitlistService.getInsights();
  }

  // Backs "select all eligible for bulk invite" — still waiting, never invited.
  @Get('uninvited')
  @RequirePermission('waitlist', 'view')
  listUninvited(@Query() dto: ListWaitlistDto) {
    return this.waitlistService.listUninvited(dto);
  }

  @Get('export')
  @RequirePermission('waitlist', 'view')
  async export(@Query() dto: ListWaitlistDto, @Res() res: Response) {
    const csv = await this.waitlistService.exportCsv(dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="waitlist.csv"');
    res.send(csv);
  }

  @Post('bulk-invite')
  @RequirePermission('waitlist', 'write')
  bulkInvite(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: BulkInviteWaitlistDto,
  ) {
    return this.waitlistService.bulkInvite(dto, admin.sub);
  }

  @Post(':id/invite')
  @RequirePermission('waitlist', 'write')
  async invite(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: InviteWaitlistDto,
  ) {
    await this.waitlistService.inviteSingle(id, dto, admin.sub);
    return { invited: true };
  }

  @Delete(':id')
  @RequirePermission('waitlist', 'delete')
  async remove(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.waitlistService.remove(id, admin.sub);
    return { removed: true };
  }
}
