import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ListReferralParticipantsDto } from './dto/list-referral-participants.dto';
import { ReferralParticipantDetailDto } from './dto/referral-participant-detail.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';

// Sibling of admin/referral-campaigns, not nested under it — same "own
// top-level admin route" precedent Escrow set relative to Transactions.
@Controller('admin/referral-participants')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminReferralParticipantsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  @RequirePermission('referrals', 'view')
  list(@Query() dto: ListReferralParticipantsDto) {
    return this.referralsService.listParticipantsAdmin(dto);
  }

  @Get(':id')
  @RequirePermission('referrals', 'view')
  detail(@Param('id') id: string, @Query() dto: ReferralParticipantDetailDto) {
    return this.referralsService.getParticipantDetailAdmin(id, dto);
  }
}
