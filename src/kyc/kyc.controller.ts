import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { KycService } from './kyc.service';
import { VerifyIdentityDto } from './dto/verify-identity.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // NIN + selfie in one request -> one provider call (QoreID NIN Face Match).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-identity')
  verifyIdentity(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: VerifyIdentityDto,
  ) {
    return this.kycService.verifyIdentity(user.sub, dto);
  }

  @Get('history')
  history(@CurrentUser() user: AccessTokenPayload) {
    return this.kycService.history(user.sub);
  }

  @Get('status')
  status(@CurrentUser() user: AccessTokenPayload) {
    return this.kycService.getStatus(user.sub);
  }
}
