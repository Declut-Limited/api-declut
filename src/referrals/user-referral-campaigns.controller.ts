import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('referral-campaigns')
@UseGuards(JwtAuthGuard)
export class UserReferralCampaignsController {
  constructor(private readonly referralsService: ReferralsService) {}

  // Every non-draft campaign — published/scheduled/ended are all visible,
  // only draft is hidden from users.
  @Get()
  list(@CurrentUser() user: AccessTokenPayload, @Query() dto: PaginationDto) {
    return this.referralsService.listAvailableForUser(user.sub, dto);
  }

  // Must come before ':idOrCode' below — otherwise Nest would match the
  // literal segment "me" as the idOrCode param.
  @Get('me')
  listMine(
    @CurrentUser() user: AccessTokenPayload,
    @Query() dto: PaginationDto,
  ) {
    return this.referralsService.listMyCampaigns(user.sub, dto);
  }

  @Get('me/:idOrCode')
  getMine(
    @Param('idOrCode') idOrCode: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.referralsService.getMyCampaignDetail(idOrCode, user.sub);
  }

  // One available (browsable) campaign, by Mongo id or internalCampaignCode.
  @Get(':idOrCode')
  getOne(
    @Param('idOrCode') idOrCode: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.referralsService.getAvailableCampaignDetail(idOrCode, user.sub);
  }

  @Post(':campaignId/join')
  join(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.referralsService.join(campaignId, user.sub);
  }

  @Post(':campaignId/leave')
  leave(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.referralsService.leave(campaignId, user.sub);
  }
}
