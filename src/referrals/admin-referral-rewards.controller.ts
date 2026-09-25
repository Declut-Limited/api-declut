import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
}
