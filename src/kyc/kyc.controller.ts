import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { KycService } from './kyc.service';
import { VerifyKycDto } from './dto/verify-kyc.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // Throttled independent of the auth-endpoint limit — this calls a paid
  // external provider per request, on top of being sensitive personal data.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify')
  verify(@CurrentUser() user: AccessTokenPayload, @Body() dto: VerifyKycDto) {
    return this.kycService.verify(user.sub, dto);
  }

  @Get('history')
  history(@CurrentUser() user: AccessTokenPayload) {
    return this.kycService.history(user.sub);
  }
}
