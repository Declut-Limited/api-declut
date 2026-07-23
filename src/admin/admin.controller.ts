import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  AdminListListingsDto,
  AdminListOffersDto,
  AdminListTransactionsDto,
  AdminListUsersDto,
} from './dto/admin-list.dto';
import { SetKycStatusDto } from './dto/set-kyc-status.dto';
import { AdminRefundDto } from './dto/admin-refund.dto';
import { UpdateAppSettingsDto } from '../settings/dto/update-app-settings.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin')
@UseGuards(AdminJwtAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers(@Query() dto: AdminListUsersDto) {
    return this.adminService.listUsers(dto.page ?? 1, dto.limit ?? 20);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Patch('users/:id/kyc')
  overrideKycStatus(@Param('id') id: string, @Body() dto: SetKycStatusDto) {
    return this.adminService.overrideKycStatus(id, dto.status);
  }

  @Get('listings')
  listListings(@Query() dto: AdminListListingsDto) {
    return this.adminService.listListings(
      dto.page ?? 1,
      dto.limit ?? 20,
      dto.status,
    );
  }

  @Get('listings/:id')
  getListing(@Param('id') id: string) {
    return this.adminService.getListing(id);
  }

  @Get('transactions')
  listTransactions(@Query() dto: AdminListTransactionsDto) {
    return this.adminService.listTransactions(
      dto.page ?? 1,
      dto.limit ?? 20,
      dto.status,
    );
  }

  @Get('transactions/:id')
  getTransaction(@Param('id') id: string) {
    return this.adminService.getTransaction(id);
  }

  @Patch('transactions/:id/release')
  releaseTransaction(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.releaseTransaction(id, admin.sub);
  }

  @Patch('transactions/:id/refund')
  refundTransaction(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
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

  @Get('settings')
  getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateAppSettingsDto) {
    return this.adminService.updateSettings(dto);
  }
}
