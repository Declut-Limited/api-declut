import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { ListPurchasesDto } from './dto/list-purchases.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('transactions')
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(private readonly transactionsService: TransactionsService) {}

  // No JwtAuthGuard — Paystack calls this directly, authenticated by HMAC
  // signature instead of a bearer token. Must stay a raw-body route (see
  // main.ts's `rawBody: true`) since the signature is computed over the
  // exact bytes Paystack sent, not our re-serialized parsed JSON.
  @Post('webhook/paystack')
  @HttpCode(HttpStatus.OK)
  async paystackWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string,
  ) {
    this.logger.log(
      `[webhook] request received at POST /transactions/webhook/paystack — hasRawBody=${!!req.rawBody} rawBodyLength=${req.rawBody?.length ?? 0} hasSignatureHeader=${!!signature}`,
    );
    if (!req.rawBody) {
      // If this ever fires, main.ts's `rawBody: true` / body-parser wiring is broken for this
      // route — handlePaystackWebhook would otherwise crash on `.length` below with a much less
      // obvious stack trace.
      this.logger.error(
        '[webhook] req.rawBody is missing — check main.ts NestFactory.create({ rawBody: true }) and any body-parser config that might run before it',
      );
    }
    await this.transactionsService.handlePaystackWebhook(
      req.rawBody!,
      signature,
    );
    return { received: true };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateTransactionDto,
  ) {
    this.logger.log(
      `[checkout] POST /transactions hit — user=${user.sub} listingId=${dto.listingId}`,
    );
    return this.transactionsService.create(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() dto: ListTransactionsDto,
  ) {
    return this.transactionsService.listForUser(user.sub, dto.page, dto.limit);
  }

  // Must come before ':id' — otherwise Nest would match "purchases" as the id.
  @UseGuards(JwtAuthGuard)
  @Get('purchases')
  listPurchases(
    @CurrentUser() user: AccessTokenPayload,
    @Query() dto: ListPurchasesDto,
  ) {
    return this.transactionsService.listPurchasesForUser(
      user.sub,
      dto.status,
      dto.page,
      dto.limit,
    );
  }

  // Must come before ':id' — otherwise Nest would match "by-reference" as the id. Used by the
  // app's payment-callback deep-link route (cold-launch/backgrounded-app case) — Paystack's
  // redirect carries its own `reference`, not our transactionId.
  @UseGuards(JwtAuthGuard)
  @Get('by-reference/:reference')
  findByReference(
    @CurrentUser() user: AccessTokenPayload,
    @Param('reference') reference: string,
  ) {
    return this.transactionsService.findForUserDisplayByReference(
      reference,
      user.sub,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.transactionsService.findForUserDisplay(id, user.sub);
  }

  // Buyer-only — no confirmation code involved. The buyer is who escrow is
  // protecting, so they're the one who attests the item arrived; this is
  // what releases the seller's payout.
  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-transaction')
  confirmReceipt(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.transactionsService.confirmReceipt(id, user.sub);
  }

  // Buyer-only, one-time — only usable once the inspection window has
  // already ended (inspectionPeriodEnded), and only while the admin's
  // inspectionWindow.allowExtension setting is on.
  @UseGuards(JwtAuthGuard)
  @Post(':id/add-inspection-extension')
  addInspectionExtension(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.transactionsService.addInspectionExtension(id, user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/cancel')
  cancel(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.transactionsService.cancel(id, user.sub);
  }

  // Buyer-only, self-serve — for a paid transaction (escrow_active/
  // awaiting_inspection), distinct from `cancel` above which only handles
  // the pre-payment case. Real Paystack refund, minus a cancellation fee.
  @UseGuards(JwtAuthGuard)
  @Post(':id/cancel-purchase')
  cancelPurchaseWithRefund(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.transactionsService.cancelPurchaseWithRefund(id, user.sub);
  }

  // Seller-only — the seller's response to a buyer's report (transaction
  // status REPORTED): refund the buyer outright. The other response,
  // raising a dispute, is POST /disputes.
  @UseGuards(JwtAuthGuard)
  @Post(':id/seller-refund')
  sellerRefundReportedPurchase(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.transactionsService.sellerRefundReportedPurchase(id, user.sub);
  }
}
