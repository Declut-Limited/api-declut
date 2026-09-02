import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PaystackService } from '../payments/paystack.service';
import { ResolveBankAccountDto } from './dto/resolve-bank-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Thin passthrough to Paystack — nothing here is persisted.
@Controller('banks')
@UseGuards(JwtAuthGuard)
export class BanksController {
  constructor(private readonly paystackService: PaystackService) {}

  @Get()
  listBanks() {
    return this.paystackService.listBanks();
  }

  @Get('resolve')
  resolve(@Query() dto: ResolveBankAccountDto) {
    return this.paystackService.resolveAccountNumber(
      dto.accountNumber,
      dto.bankCode,
    );
  }
}
