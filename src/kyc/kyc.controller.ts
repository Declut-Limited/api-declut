import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { KycService } from './kyc.service';
import { VerifyNinDto } from './dto/verify-nin.dto';
import { LivenessCheckDto } from './dto/liveness-check.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-nin')
  verifyNin(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: VerifyNinDto,
  ) {
    return this.kycService.verifyNin(user.sub, dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('liveness-check')
  livenessCheck(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: LivenessCheckDto,
  ) {
    return this.kycService.checkLiveness(user.sub, dto);
  }

  @Get('history')
  history(@CurrentUser() user: AccessTokenPayload) {
    return this.kycService.history(user.sub);
  }
}
