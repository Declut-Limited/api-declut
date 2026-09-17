import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

// Seller-only — submitting a dispute in response to a buyer's report on a
// purchase in progress (transaction status REPORTED). The other response,
// refunding outright, is POST /transactions/:id/seller-refund.
@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post('raise-dispute')
  raiseDispute(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateDisputeDto,
  ) {
    return this.disputesService.create(user.sub, dto);
  }
}
