import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PaystackService } from '../payments/paystack.service';
import { NigerianBanksService } from './nigerian-banks.service';
import { ResolveBankAccountDto } from './dto/resolve-bank-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('banks')
@UseGuards(JwtAuthGuard)
export class BanksController {
  constructor(
    private readonly paystackService: PaystackService,
    private readonly nigerianBanksService: NigerianBanksService,
  ) {}

  // Paystack stays authoritative for code/active — nigerianbanks.xyz only
  // enriches with slug/logoUrl where a matching code exists there.
  @Get()
  async listBanks() {
    const [banks, extrasByCode] = await Promise.all([
      this.paystackService.listBanks(),
      this.nigerianBanksService.getMap(),
    ]);
    return banks.map((bank) => {
      const extra = extrasByCode.get(bank.code);
      return {
        code: bank.code,
        name: bank.name,
        shortName: bank.name,
        fullName: bank.name,
        slug: extra?.slug,
        logoUrl: extra?.logo,
      };
    });
  }

  @Get('resolve')
  resolve(@Query() dto: ResolveBankAccountDto) {
    return this.paystackService.resolveAccountNumber(
      dto.accountNumber,
      dto.bankCode,
    );
  }
}
