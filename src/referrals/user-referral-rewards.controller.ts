import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

// User-facing counterpart of admin/referral-rewards — only ever the
// caller's own rewards, across every campaign they've joined.
@Controller('referral-rewards')
@UseGuards(JwtAuthGuard)
export class UserReferralRewardsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenPayload, @Query() dto: PaginationDto) {
    return this.referralsService.listMyRewards(user.sub, dto);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.referralsService.getMyReward(id, user.sub);
  }
}
