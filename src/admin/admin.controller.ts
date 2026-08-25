import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import {
  AdminListListingsDto,
  AdminListOffersDto,
  AdminListReviewsDto,
  AdminListTransactionsDto,
  AdminListUsersDto,
  PageDto,
} from './dto/admin-list.dto';
import { SetKycStatusDto } from './dto/set-kyc-status.dto';
import { AdminRefundDto } from './dto/admin-refund.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { EmailSellerDto } from './dto/email-seller.dto';
import { DashboardInsightsDto, RevenueTrendsDto } from './dto/dashboard.dto';
import { UpdateAppSettingsDto } from '../settings/dto/update-app-settings.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // Grouped under 'transactions' — no dedicated 'dashboard' RBAC bucket
  // exists, and these two endpoints are overwhelmingly transaction/revenue
  // data, same judgment call already made for the 'offers' routes below.
  @Get('dashboard/insights')
  @RequirePermission('transactions', 'view')
  getDashboardInsights(@Query() dto: DashboardInsightsDto) {
    return this.adminService.getDashboardInsights(
      dto.filter,
      dto.startDate,
      dto.endDate,
    );
  }

  @Get('dashboard/revenue-trends')
  @RequirePermission('transactions', 'view')
  getRevenueTrends(@Query() dto: RevenueTrendsDto) {
    return this.adminService.getRevenueTrends(dto.year);
  }

  // Listings data, not transactions — 'listings' bucket, unlike the two dashboard routes above.
  @Get('dashboard/listings-per-month')
  @RequirePermission('listings', 'view')
  getListingsPerMonth() {
    return this.adminService.getListingsPerMonth();
  }

  @Get('users')
  @RequirePermission('users', 'view')
  listUsers(@Query() dto: AdminListUsersDto) {
    return this.adminService.listUsers(dto);
  }

  // Must come before 'users/:id' — otherwise Nest matches "export" as :id.
  @Get('users/export')
  @RequirePermission('users', 'view')
  async exportUsers(@Res() res: Response) {
    const csv = await this.adminService.exportUsersCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(csv);
  }

  @Get('users/:id')
  @RequirePermission('users', 'view')
  getUser(@Param('id') id: string) {
    return this.adminService.getUserOrAdminDetail(id);
  }

  @Patch('users/:id/suspend')
  @RequirePermission('users', 'write')
  suspendUser(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.adminService.suspendUser(id, admin.sub, dto);
  }

  @Patch('users/:id/reactivate')
  @RequirePermission('users', 'write')
  reactivateUser(@Param('id') id: string) {
    return this.adminService.reactivateUser(id);
  }

  @Patch('users/:id/kyc')
  @RequirePermission('users', 'write')
  overrideKycStatus(@Param('id') id: string, @Body() dto: SetKycStatusDto) {
    return this.adminService.overrideKycStatus(id, dto.status);
  }

  @Get('listings')
  @RequirePermission('listings', 'view')
  listListings(@Query() dto: AdminListListingsDto) {
    return this.adminService.listListings(dto);
  }

  // Must come before 'listings/:slug' — otherwise Nest matches "by-user" as
  // the slug (same hazard as 'users/export' above).
  @Get('listings/by-user/:idOrSlug')
  @RequirePermission('listings', 'view')
  getListingsByUser(
    @Param('idOrSlug') idOrSlug: string,
    @Query() dto: PageDto,
  ) {
    return this.adminService.getListingsByUser(
      idOrSlug,
      dto.page ?? 1,
      dto.limit ?? 20,
    );
  }

  @Get('listings/:slug')
  @RequirePermission('listings', 'view')
  getListing(@Param('slug') slug: string) {
    return this.adminService.getListingBySlug(slug);
  }

  @Post('listings/:id/email-seller')
  @RequirePermission('listings', 'write')
  emailSeller(@Param('id') id: string, @Body() dto: EmailSellerDto) {
    return this.adminService.emailSeller(id, dto);
  }

  @Patch('listings/:id/flag')
  @RequirePermission('listings', 'write')
  flagListing(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.flagListing(id, admin.sub);
  }

  @Delete('listings/:id')
  @RequirePermission('listings', 'delete')
  removeListing(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.removeListing(id, admin.sub);
  }

  @Get('transactions')
  @RequirePermission('transactions', 'view')
  listTransactions(@Query() dto: AdminListTransactionsDto) {
    return this.adminService.listTransactions(dto);
  }

  @Get('transactions/:id')
  @RequirePermission('transactions', 'view')
  getTransaction(@Param('id') id: string) {
    return this.adminService.getTransaction(id);
  }

  @Patch('transactions/:id/release')
  @RequirePermission('transactions', 'write')
  releaseTransaction(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.releaseTransaction(id, admin.sub);
  }

  @Patch('transactions/:id/refund')
  @RequirePermission('transactions', 'write')
  refundTransaction(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AdminRefundDto,
  ) {
    return this.adminService.refundTransaction(id, admin.sub, dto.reason);
  }

  // Offers has no permission bucket of its own in the RBAC module list —
  // grouped under transactions since an offer only ever matters as the
  // pre-checkout step feeding one.
  @Get('offers')
  @RequirePermission('transactions', 'view')
  listOffers(@Query() dto: AdminListOffersDto) {
    return this.adminService.listOffers(dto.page ?? 1, dto.limit ?? 20);
  }

  @Get('reviews')
  @RequirePermission('reviews', 'view')
  listReviews(@Query() dto: AdminListReviewsDto) {
    return this.adminService.listReviews(dto);
  }

  @Patch('reviews/:id/flag')
  @RequirePermission('reviews', 'write')
  flagReview(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.flagReview(id, admin.sub);
  }

  @Patch('reviews/:id/resolve')
  @RequirePermission('reviews', 'write')
  resolveReview(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.resolveReview(id, admin.sub);
  }

  @Delete('reviews/:id')
  @RequirePermission('reviews', 'delete')
  async removeReview(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.adminService.removeReview(id, admin.sub);
    return { removed: true };
  }

  @Get('settings')
  @RequirePermission('settings', 'view')
  getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  @RequirePermission('settings', 'write')
  updateSettings(@Body() dto: UpdateAppSettingsDto) {
    return this.adminService.updateSettings(dto);
  }
}
