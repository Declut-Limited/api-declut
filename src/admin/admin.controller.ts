import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  AdminListListingsDto,
  AdminListOffersDto,
  AdminListTransactionsDto,
  AdminListUsersDto,
} from './dto/admin-list.dto';
import { SetKycStatusDto } from './dto/set-kyc-status.dto';
import { AdminRefundDto } from './dto/admin-refund.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers(@Query() dto: AdminListUsersDto) {
    return this.adminService.listUsers(dto.page ?? 1, dto.limit ?? 20, dto.role);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Patch('users/:id/promote')
  promoteToAdmin(@Param('id') id: string) {
    return this.adminService.promoteToAdmin(id);
  }

  @Patch('users/:id/kyc')
  overrideKycStatus(@Param('id') id: string, @Body() dto: SetKycStatusDto) {
    return this.adminService.overrideKycStatus(id, dto.status);
  }

  @Get('listings')
  listListings(@Query() dto: AdminListListingsDto) {
    return this.adminService.listListings(dto.page ?? 1, dto.limit ?? 20, dto.status);
  }

  @Get('listings/:id')
  getListing(@Param('id') id: string) {
    return this.adminService.getListing(id);
  }

  @Get('transactions')
  listTransactions(@Query() dto: AdminListTransactionsDto) {
    return this.adminService.listTransactions(dto.page ?? 1, dto.limit ?? 20, dto.status);
  }

  @Get('transactions/:id')
  getTransaction(@Param('id') id: string) {
    return this.adminService.getTransaction(id);
  }

  @Patch('transactions/:id/release')
  releaseTransaction(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.releaseTransaction(id, admin.sub);
  }

  @Patch('transactions/:id/refund')
  refundTransaction(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AdminRefundDto,
  ) {
    return this.adminService.refundTransaction(id, admin.sub, dto.reason);
  }

  @Get('offers')
  listOffers(@Query() dto: AdminListOffersDto) {
    return this.adminService.listOffers(dto.page ?? 1, dto.limit ?? 20);
  }

  @Delete('reviews/:id')
  async removeReview(@Param('id') id: string) {
    await this.adminService.removeReview(id);
    return { removed: true };
  }
}
