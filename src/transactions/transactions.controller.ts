import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
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
import { ConfirmCodeDto } from './dto/confirm-code.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('transactions')
export class TransactionsController {
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
    await this.transactionsService.handlePaystackWebhook(req.rawBody!, signature);
    return { received: true };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: AccessTokenPayload, @Query() dto: ListTransactionsDto) {
    return this.transactionsService.listForUser(user.sub, dto.page, dto.limit);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.transactionsService.findForUser(id, user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-code')
  confirmCode(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmCodeDto,
  ) {
    return this.transactionsService.confirmCode(id, user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/cancel')
  cancel(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.transactionsService.cancel(id, user.sub);
  }
}
