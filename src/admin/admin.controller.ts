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
  AdminListReviewsDto,
  AdminListTransactionsDto,
  AdminListUsersDto,
  PageDto,
} from './dto/admin-list.dto';
import { SetKycStatusDto } from './dto/set-kyc-status.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { BanUserDto } from './dto/ban-user.dto';
import { EmailSellerDto } from './dto/email-seller.dto';
import { CreateTransactionNoteDto } from './dto/create-transaction-note.dto';
import { UpdateTransactionNoteDto } from './dto/update-transaction-note.dto';
import { SendInspectionReminderDto } from './dto/send-inspection-reminder.dto';
import { UpdateListingDto } from '../listings/dto/update-listing.dto';
import { DashboardInsightsDto, RevenueTrendsDto } from './dto/dashboard.dto';
import { UpdateGeneralSettingsDto } from '../settings/dto/update-general-settings.dto';
import { UpdatePaymentSettingsDto } from '../settings/dto/update-payment-settings.dto';
import { UpdateFeesSettingsDto } from '../settings/dto/update-fees-settings.dto';
import { UpdateIssueResolutionSlaDto } from '../settings/dto/update-issue-resolution-sla.dto';
import { DateRangeDto } from '../common/dto/date-range.dto';
import { ListEscrowsDto } from '../escrow/dto/list-escrows.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard/insights')
  @RequirePermission('dashboard', 'view')
  getDashboardInsights(@Query() dto: DashboardInsightsDto) {
    return this.adminService.getDashboardInsights(
      dto.filter,
      dto.startDate,
      dto.endDate,
    );
  }

  @Get('dashboard/revenue-trends')
  @RequirePermission('dashboard', 'view')
  getRevenueTrends(@Query() dto: RevenueTrendsDto) {
    return this.adminService.getRevenueTrends(dto.year);
  }

  @Get('dashboard/listings-per-month')
  @RequirePermission('dashboard', 'view')
  getListingsPerMonth() {
    return this.adminService.getListingsPerMonth();
  }

  @Get('dashboard/category-distribution')
  @RequirePermission('dashboard', 'view')
  getCategoryDistribution() {
    return this.adminService.getCategoryDistribution();
  }

  @Get('dashboard/transaction-breakdown')
  @RequirePermission('dashboard', 'view')
  getTransactionStatusBreakdown() {
    return this.adminService.getTransactionStatusBreakdown();
  }

  @Get('dashboard/recent-activity')
  @RequirePermission('dashboard', 'view')
  getRecentActivity() {
    return this.adminService.getRecentActivity();
  }

  @Get('users')
  @RequirePermission('users', 'view')
  listUsers(@Query() dto: AdminListUsersDto) {
    return this.adminService.listUsers(dto);
  }

  // Must come before 'users/:idOrSlug' — otherwise Nest matches "export" as the param.
  @Get('users/export')
  @RequirePermission('users', 'view')
  async exportUsers(@Query() dto: DateRangeDto, @Res() res: Response) {
    const csv = await this.adminService.exportUsersCsv(dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(csv);
  }

  // Param renamed id -> idOrSlug (2026-09-18, explicit instruction) — the
  // service already resolved a User by slug; the Admin branch now does too.
  @Get('users/:idOrSlug')
  @RequirePermission('users', 'view')
  getUser(@Param('idOrSlug') idOrSlug: string) {
    return this.adminService.getUserOrAdminDetail(idOrSlug);
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

  @Patch('users/:id/deactivate')
  @RequirePermission('users', 'write')
  deactivateUser(@Param('id') id: string) {
    return this.adminService.deactivateUser(id);
  }

  @Patch('users/:id/ban')
  @RequirePermission('users', 'write')
  banUser(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: BanUserDto,
  ) {
    return this.adminService.banUser(id, admin.sub, dto);
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

  // Must come before 'listings/:idOrSlug' — otherwise Nest matches "export" as the param (same hazard as 'users/export' above).
  @Get('listings/export')
  @RequirePermission('listings', 'view')
  async exportListings(
    @Query() dto: AdminListListingsDto,
    @Res() res: Response,
  ) {
    const status = dto.status && dto.status !== 'all' ? dto.status : undefined;
    const csv = await this.adminService.exportListingsCsv(
      status,
      dto.search,
      dto,
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="listings.csv"');
    res.send(csv);
  }

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
      dto,
    );
  }

  // Merged from separate 'listings/id/:id' and 'listings/:slug' routes
  // (2026-09-18, explicit instruction) — one handler, id-or-slug dispatch
  // lives in ListingsService.adminFindByIdOrSlug().
  @Get('listings/:idOrSlug')
  @RequirePermission('listings', 'view')
  getListing(@Param('idOrSlug') idOrSlug: string) {
    return this.adminService.getListingByIdOrSlug(idOrSlug);
  }

  @Post('listings/:id/email-seller')
  @RequirePermission('listings', 'write')
  emailSeller(@Param('id') id: string, @Body() dto: EmailSellerDto) {
    return this.adminService.emailSeller(id, dto);
  }

  @Patch('listings/:id')
  @RequirePermission('listings', 'write')
  updateListing(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.adminService.adminUpdateListing(id, admin.sub, dto);
  }

  @Patch('listings/:id/delist')
  @RequirePermission('listings', 'write')
  delistListing(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.delistListing(id, admin.sub);
  }

  @Patch('listings/:id/relist')
  @RequirePermission('listings', 'write')
  relistListing(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.relistListing(id, admin.sub);
  }

  @Get('transactions')
  @RequirePermission('transactions', 'view')
  listTransactions(@Query() dto: AdminListTransactionsDto) {
    return this.adminService.listTransactions(dto);
  }

  // Must come before 'transactions/:idOrRef' — otherwise Nest matches "export" as the idOrRef (same hazard as 'listings/export' above).
  @Get('transactions/export')
  @RequirePermission('transactions', 'view')
  async exportTransactions(
    @Query() dto: AdminListTransactionsDto,
    @Res() res: Response,
  ) {
    const csv = await this.adminService.exportTransactionsCsv(dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="transactions.csv"',
    );
    res.send(csv);
  }

  @Get('transactions/:idOrRef')
  @RequirePermission('transactions', 'view')
  getTransactionDetail(@Param('idOrRef') idOrRef: string) {
    return this.adminService.getTransactionDetail(idOrRef);
  }

  // Must come before 'escrows/:idOrSlug' below — otherwise Nest matches
  // "export" as the idOrSlug (same hazard as 'transactions/export' above).
  // Lives here rather than on AdminEscrowController (src/escrow/, where the
  // sibling GET /admin/escrows list route lives) specifically so it's
  // guaranteed to be registered before 'escrows/:idOrSlug' — that route also
  // lives in this same controller, and relying on cross-module/cross-
  // controller registration order for two conflicting paths would be
  // fragile. EscrowService.exportCsv() does the actual work; AdminModule
  // now imports EscrowModule for this (no cycle — EscrowModule only imports
  // AdminAuthModule, not AdminModule). Same transactions/view permission
  // bucket the escrow list/detail already use (no dedicated escrow bucket).
  @Get('escrows/export')
  @RequirePermission('transactions', 'view')
  async exportEscrows(@Query() dto: ListEscrowsDto, @Res() res: Response) {
    const csv = await this.adminService.exportEscrowsCsv(dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="escrows.csv"');
    res.send(csv);
  }

  // Lives here, not on AdminEscrowController (src/escrow/) where the
  // sibling GET /admin/escrows list route lives — TransactionsService is
  // what actually builds this shape (reusing the transaction detail's own
  // logic almost entirely), and EscrowModule can't inject TransactionsModule
  // without a cycle (TransactionsModule already imports EscrowModule). Same
  // transactions/view permission bucket the escrow list already uses (no
  // dedicated escrow RBAC bucket exists). 2026-09-18, explicit instruction.
  @Get('escrows/:idOrSlug')
  @RequirePermission('transactions', 'view')
  getEscrowDetail(@Param('idOrSlug') idOrSlug: string) {
    return this.adminService.getEscrowDetail(idOrSlug);
  }

  @Post('transactions/:id/send-inspection-reminder')
  @RequirePermission('transactions', 'write')
  sendInspectionReminder(
    @Param('id') id: string,
    @Body() dto: SendInspectionReminderDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.adminService.sendInspectionReminder(id, admin.sub, dto);
  }

  @Post('transaction-notes')
  @RequirePermission('transactions', 'write')
  createTransactionNote(
    @Body() dto: CreateTransactionNoteDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.adminService.createTransactionNote(dto, admin.sub);
  }

  @Patch('transaction-notes/:id')
  @RequirePermission('transactions', 'write')
  updateTransactionNote(
    @Param('id') id: string,
    @Body() dto: UpdateTransactionNoteDto,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.adminService.updateTransactionNote(id, admin.sub, dto);
  }

  @Delete('transaction-notes/:id')
  @RequirePermission('transactions', 'delete')
  removeTransactionNote(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminAccessTokenPayload,
  ) {
    return this.adminService.removeTransactionNote(id, admin.sub);
  }

  @Get('reviews')
  @RequirePermission('reviews', 'view')
  listReviews(@Query() dto: AdminListReviewsDto) {
    return this.adminService.listReviews(dto);
  }

  @Get('reviews/export')
  @RequirePermission('reviews', 'view')
  async exportReviews(@Query() dto: AdminListReviewsDto, @Res() res: Response) {
    const csv = await this.adminService.exportReviewsCsv(dto.status, dto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="reviews.csv"');
    res.send(csv);
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

  @Get('settings')
  @RequirePermission('settings', 'view')
  getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings/general')
  @RequirePermission('settings', 'write')
  updateGeneralSettings(@Body() dto: UpdateGeneralSettingsDto) {
    return this.adminService.updateGeneralSettings(dto);
  }

  @Patch('settings/payments')
  @RequirePermission('settings', 'write')
  updatePaymentSettings(@Body() dto: UpdatePaymentSettingsDto) {
    return this.adminService.updatePaymentSettings(dto);
  }

  @Patch('settings/fees-and-commission')
  @RequirePermission('settings', 'write')
  updateFeesSettings(@Body() dto: UpdateFeesSettingsDto) {
    return this.adminService.updateFeesSettings(dto);
  }

  @Patch('settings/issue-resolution-sla')
  @RequirePermission('settings', 'write')
  updateIssueResolutionSlaSettings(@Body() dto: UpdateIssueResolutionSlaDto) {
    return this.adminService.updateIssueResolutionSlaSettings(dto);
  }
}
