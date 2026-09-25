import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ReferralsService } from './referrals.service';
import { ListReferralRewardsDto } from './dto/list-referral-rewards.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';

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
}
