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
import { ReferralsService } from './referrals.service';
import { ListReferralRewardsDto } from './dto/list-referral-rewards.dto';
import { BulkMarkRewardsPaidDto } from './dto/bulk-mark-rewards-paid.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

// Sibling of admin/referral-campaigns, same precedent as
// AdminReferralParticipantsController above.
@Controller('admin/referral-rewards')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminReferralRewardsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  @RequirePermission('referrals', 'view')
  list(@Query() dto: ListReferralRewardsDto) {
    return this.referralsService.listRewardsAdmin(dto);
  }

  // No ':id' route exists yet on this controller, so no ordering hazard —
  // still named/placed consistently with every other export in this app.
  @Get('export')
  @RequirePermission('referrals', 'view')
  async export(@Query() dto: ListReferralRewardsDto, @Res() res: Response) {
    const csv = await this.referralsService.exportRewardsCsv(dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="referral-rewards.csv"',
    );
    res.send(csv);
  }

  // No ':id' prefix, so no ordering hazard against ':id/mark-paid' below —
  // still placed before it for readability.
  @Post('bulk-mark-paid')
  @RequirePermission('referrals', 'write')
  bulkMarkPaid(
    @Body() dto: BulkMarkRewardsPaidDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.referralsService.bulkMarkRewardsPaid(dto.rewardIds, admin.sub);
  }

  @Patch(':id/mark-paid')
  @RequirePermission('referrals', 'write')
  markPaid(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.referralsService.markRewardPaid(id, admin.sub);
  }
}
