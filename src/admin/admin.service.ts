import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { ListingsService } from '../listings/listings.service';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionStatus } from '../transactions/schemas/transaction.schema';
import { OffersService } from '../offers/offers.service';
import { ReviewsService } from '../reviews/reviews.service';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { KycService } from '../kyc/kyc.service';
import { KycStatus } from '../users/schemas/user.schema';
import { SettingsService } from '../settings/settings.service';
import { UpdateAppSettingsDto } from '../settings/dto/update-app-settings.dto';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import type { AdminDocument } from '../admin-auth/schemas/admin.schema';
import { EmailService } from '../email/email.service';
import {
  AdminListListingsDto,
  AdminListReviewsDto,
  AdminListTransactionsDto,
  AdminListUsersDto,
  TransactionTab,
} from './dto/admin-list.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { EmailSellerDto } from './dto/email-seller.dto';
import type { DashboardInsightsPeriod } from './dto/dashboard.dto';
import { toCsv } from '../common/utils/csv.util';
import { countTrend, ALL_TIME_TREND } from '../common/utils/trend.util';

/**
 * Thin orchestration layer over services that already exist — every method
 * here delegates to a single call on UsersService/ListingsService/etc.
 * (each of which already enforces its own invariants). Kept as its own
 * service, rather than having AdminController call five different services
 * directly, so the controller stays routes-only per this codebase's layering
 * convention, even though there's no admin-specific business logic beyond
 * "which service method to call." The Users federation below is the one
 * genuine exception — it spans Users + Admin + Listings, so the merge
 * itself lives here rather than being forced into a single domain service.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly usersService: UsersService,
    private readonly listingsService: ListingsService,
    private readonly transactionsService: TransactionsService,
    private readonly offersService: OffersService,
    private readonly reviewsService: ReviewsService,
    private readonly trustScoreService: TrustScoreService,
    private readonly settingsService: SettingsService,
    private readonly adminAuthService: AdminAuthService,
    private readonly kycService: KycService,
    private readonly emailService: EmailService,
  ) {}

  async listUsers(dto: AdminListUsersDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    // A status filter is a User-only concept (Admins have no accountStatus)
    // — applying one narrows the federated view down to Users only.
    const [users, admins] = await Promise.all([
      this.usersService.adminSearchUsers({
        status: dto.status,
        search: dto.search,
      }),
      dto.status
        ? Promise.resolve<AdminDocument[]>([])
        : this.adminAuthService.searchAdmins(dto.search),
    ]);

    const listingCounts = await this.listingsService.countsBySeller(
      users.map((u) => u._id.toString()),
    );

    type Row = {
      type: 'user' | 'admin';
      id: string;
      name: string;
      email: string;
      role: string;
      listingsCount: number;
      status: string;
      joinedAt: Date;
    };

    const userRows: Row[] = users.map((u) => ({
      type: 'user' as const,
      id: u._id.toString(),
      name: u.name,
      email: u.email,
      role: 'User',
      listingsCount: listingCounts.get(u._id.toString())?.total ?? 0,
      status: u.accountStatus,
      joinedAt: (u as unknown as { createdAt: Date }).createdAt,
    }));

    const adminRows: Row[] = admins.map((a) => ({
      type: 'admin' as const,
      id: a._id.toString(),
      name: a.name,
      email: a.email,
      // Literal, like 'User' above — there are only two account roles.
      // a.title (job title, e.g. "Support Lead") is a display label, never
      // what's shown in the role column; permissions are what actually
      // distinguish one admin from another.
      role: 'Admin',
      listingsCount: 0,
      status: 'active',
      joinedAt: (a as unknown as { createdAt: Date }).createdAt,
    }));

    // Merged then paginated in memory — acceptable at this scale (admin
    // headcount + marketplace users), but won't scale indefinitely; a
    // proper federated cursor would be the fix if this list ever gets huge.
    const combined = [...userRows, ...adminRows].sort(
      (a, b) => b.joinedAt.getTime() - a.joinedAt.getTime(),
    );

    const total = combined.length;
    const start = (page - 1) * limit;
    const results = combined.slice(start, start + limit);

    return { results, total, page, limit };
  }

  async exportUsersCsv(): Promise<string> {
    const { results } = await this.listUsers({ page: 1, limit: 10_000 });
    return toCsv(results, [
      'type',
      'id',
      'name',
      'email',
      'role',
      'listingsCount',
      'status',
      'joinedAt',
    ]);
  }

  async getUserOrAdminDetail(id: string) {
    const user = await this.usersService.findById(id);
    if (user) {
      const [listingCounts, txInsights, recentTransactions, kycHistory] =
        await Promise.all([
          this.listingsService.countsBySeller([id]),
          this.transactionsService.getUserTransactionInsights(id),
          this.transactionsService.getRecentForUser(id, 3),
          this.kycService.history(id),
        ]);
      const latestKyc = kycHistory[0];

      return {
        type: 'user' as const,
        insights: {
          listings: listingCounts.get(id) ?? { total: 0, active: 0 },
          sales: txInsights.sales,
          purchases: txInsights.purchases,
          rating: {
            value: user.avgRating.toFixed(1),
            reviewCount: user.reviewCount,
          },
        },
        details: {
          role: 'User',
          name: user.name,
          status: user.accountStatus,
          createdAt: (user as unknown as { createdAt: Date }).createdAt,
          rating: user.avgRating.toFixed(1),
          reviewCount: user.reviewCount,
          trustScore: user.trustScore,
          authProvider: user.authProvider,
          emailVerified: user.emailVerified,
          kycStatus: user.kycStatus,
          kyc: user.kyc,
          verification: latestKyc
            ? {
                status: latestKyc.status,
                submittedAt: latestKyc.createdAt,
                documentType: latestKyc.stage,
              }
            : null,
          slug: user.slug,
          email: user.email,
          phone: user.phone,
        },
        recentTransactions,
      };
    }

    const admin = await this.adminAuthService.findById(id);
    if (admin) {
      return {
        type: 'admin' as const,
        details: {
          // Literal, like 'User' above — the only two account roles.
          // title is the free-text job title; permissions (below) are what
          // actually distinguish one admin from another.
          role: 'Admin',
          title: admin.title,
          status: 'active',
          company: admin.company,
          createdAt: (admin as unknown as { createdAt: Date }).createdAt,
          email: admin.email,
          permissions: admin.permissions,
        },
      };
    }

    throw new NotFoundException('User not found');
  }

  async suspendUser(userId: string, adminId: string, dto: SuspendUserDto) {
    await this.usersService.suspend(userId, adminId, dto);
    return this.usersService.getPrivateProfile(userId);
  }

  async reactivateUser(userId: string) {
    await this.usersService.reactivate(userId);
    return this.usersService.getPrivateProfile(userId);
  }

  async overrideKycStatus(userId: string, status: KycStatus) {
    await this.usersService.setKycStatus(userId, status);
    if (status === KycStatus.VERIFIED) {
      await this.trustScoreService.recalculate(userId);
    }
    return this.usersService.getPrivateProfile(userId);
  }

  listListings(dto: AdminListListingsDto) {
    const status = dto.status && dto.status !== 'all' ? dto.status : undefined;
    return this.listingsService.adminList(
      dto.page ?? 1,
      dto.limit ?? 20,
      status,
      dto.search,
    );
  }

  async getListingBySlug(slug: string) {
    const { listing, recentActivity } =
      await this.listingsService.adminFindBySlug(slug);
    const sellerId = listing.seller.toString();
    const [seller, listingCounts] = await Promise.all([
      this.usersService.findById(sellerId),
      this.listingsService.countsBySeller([sellerId]),
    ]);

    return {
      images: listing.images.map((url) => ({ url })),
      title: listing.title,
      status: listing.status,
      category: listing.category,
      createdAt: (listing as unknown as { createdAt: Date }).createdAt,
      views: listing.views,
      saves: listing.saves,
      price: listing.price,
      address: listing.locationLabel,
      description: listing.description,
      specs: {
        brand: listing.specs?.brand,
        condition: listing.condition,
        quantity: listing.specs?.quantity,
        sku: listing.specs?.sku,
      },
      priceHistory: listing.priceHistory,
      recentActivity,
      seller: seller
        ? {
            id: seller._id.toString(),
            slug: seller.slug,
            name: seller.name,
            email: seller.email,
            phone: seller.phone,
            status: seller.accountStatus,
            totalListings: listingCounts.get(sellerId)?.total ?? 0,
            rating: seller.avgRating.toFixed(1),
            createdAt: (seller as unknown as { createdAt: Date }).createdAt,
          }
        : null,
    };
  }

  async emailSeller(listingId: string, dto: EmailSellerDto) {
    const listing = await this.listingsService.adminFindById(listingId);
    const seller = await this.usersService.findById(listing.seller.toString());
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }
    await this.emailService.sendEmail({
      to: seller.email,
      toName: seller.name,
      subject: dto.subject,
      html: `<p>${escapeHtml(dto.message).replace(/\n/g, '<br>')}</p>`,
    });
    return { sent: true };
  }

  flagListing(id: string, adminId: string) {
    return this.listingsService.flag(id, adminId);
  }

  async removeListing(id: string, adminId: string) {
    await this.listingsService.adminRemove(id, adminId);
    return { removed: true };
  }

  async getListingsByUser(idOrSlug: string, page: number, limit: number) {
    const user = await this.usersService.findByIdOrSlug(idOrSlug);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.listingsService.byUser(user._id.toString(), page, limit);
  }

  // `status` is an exact override; `tab` groups related statuses for an
  // admin UI tab strip. Grouping is a judgment call (CLAUDE.md named the
  // tabs without defining them) — 'active' spans everything before a
  // terminal state, 'refunded' folds in 'cancelled' since both mean "no
  // money moved to the seller."
  private static readonly TAB_STATUS_MAP: Record<
    Exclude<TransactionTab, 'all'>,
    TransactionStatus[]
  > = {
    active: [
      TransactionStatus.PENDING_PAYMENT,
      TransactionStatus.ESCROW_ACTIVE,
      TransactionStatus.AWAITING_INSPECTION,
    ],
    completed: [TransactionStatus.COMPLETED],
    disputed: [TransactionStatus.DISPUTED],
    stalled: [TransactionStatus.STALLED],
    refunded: [TransactionStatus.REFUNDED, TransactionStatus.CANCELLED],
  };

  listTransactions(dto: AdminListTransactionsDto) {
    let statuses: TransactionStatus[] | undefined;
    if (dto.status) {
      statuses = [dto.status];
    } else if (dto.tab && dto.tab !== 'all') {
      statuses = AdminService.TAB_STATUS_MAP[dto.tab];
    }
    return this.transactionsService.adminList(
      dto.page ?? 1,
      dto.limit ?? 20,
      statuses,
    );
  }

  getTransaction(transactionId: string) {
    return this.transactionsService.adminFindByIdDetailed(transactionId);
  }

  releaseTransaction(transactionId: string, adminId: string) {
    return this.transactionsService.adminRelease(transactionId, adminId);
  }

  refundTransaction(transactionId: string, adminId: string, reason?: string) {
    return this.transactionsService.adminRefund(transactionId, adminId, reason);
  }

  listOffers(page: number, limit: number) {
    return this.offersService.adminList(page, limit);
  }

  listReviews(dto: AdminListReviewsDto) {
    return this.reviewsService.adminList(
      dto.page ?? 1,
      dto.limit ?? 20,
      dto.status,
    );
  }

  flagReview(reviewId: string, adminId: string) {
    return this.reviewsService.adminFlag(reviewId, adminId);
  }

  resolveReview(reviewId: string, adminId: string) {
    return this.reviewsService.adminResolve(reviewId, adminId);
  }

  removeReview(reviewId: string, adminId: string) {
    return this.reviewsService.adminRemove(reviewId, adminId);
  }

  getSettings() {
    return this.settingsService.get();
  }

  updateSettings(dto: UpdateAppSettingsDto) {
    return this.settingsService.update(dto);
  }

  // Spans Users + Listings + Transactions — same "genuine exception, lives
  // here rather than forced into one domain service" reasoning as the Users
  // federation above. No dedicated 'dashboard' RBAC bucket exists (same
  // judgment call already made for Offers, grouped under 'transactions' in
  // the controller) since these two endpoints are overwhelmingly
  // transaction/revenue data.
  private static periodStart(
    period: DashboardInsightsPeriod,
  ): Date | undefined {
    const now = new Date();
    switch (period) {
      case 'today':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1);
      case 'year':
        return new Date(now.getFullYear(), 0, 1);
      case 'all':
      default:
        return undefined;
    }
  }

  // Prior period = same elapsed length, immediately before `since` — not a calendar-aligned lookback (judgment call).
  private static periodRange(period: DashboardInsightsPeriod): {
    since?: Date;
    priorSince?: Date;
    priorUntil?: Date;
  } {
    const since = AdminService.periodStart(period);
    if (!since) return {};
    const elapsedMs = Date.now() - since.getTime();
    return {
      since,
      priorSince: new Date(since.getTime() - elapsedMs),
      priorUntil: since,
    };
  }

  // "{count} new this week" phrasing for the two plain-count cards below — matches the dashboard mock's style instead of a generic percentage.
  private static readonly PERIOD_LABELS: Record<
    DashboardInsightsPeriod,
    string
  > = {
    today: 'today',
    week: 'this week',
    month: 'this month',
    year: 'this year',
    all: 'all time',
  };

  // 8 cards, each {value, extra: {status, result}} — no chart/donut/activity-feed, explicitly out of scope.
  async getDashboardInsights(period: DashboardInsightsPeriod = 'month') {
    const { since, priorSince, priorUntil } = AdminService.periodRange(period);
    const periodLabel = AdminService.PERIOD_LABELS[period];

    const [
      newUsers,
      priorNewUsers,
      activeListings,
      newListings,
      priorNewListings,
      txSummary,
    ] = await Promise.all([
      this.usersService.countNewInPeriod(since),
      priorSince
        ? this.usersService.countNewInPeriod(priorSince, priorUntil)
        : 0,
      this.listingsService.countActive(),
      this.listingsService.countCreatedInRange(since),
      priorSince
        ? this.listingsService.countCreatedInRange(priorSince, priorUntil)
        : 0,
      this.transactionsService.getDashboardInsights(
        since,
        priorSince,
        priorUntil,
      ),
    ]);

    return {
      period,
      cards: {
        newUsers: {
          value: newUsers,
          extra: since
            ? countTrend(newUsers, periodLabel, priorNewUsers, true)
            : ALL_TIME_TREND,
        },
        // activeListings itself is a live total with no period of its own — its trend uses the listing-creation rate instead.
        activeListings: {
          value: activeListings,
          extra: since
            ? countTrend(newListings, periodLabel, priorNewListings, true)
            : ALL_TIME_TREND,
        },
        ...txSummary,
      },
    };
  }

  async getRevenueTrends(year: number = new Date().getFullYear()) {
    const { trend, insights } =
      await this.transactionsService.getRevenueTrends(year);
    return { year, trend, insights };
  }
}

// Minimal escaping — the admin-composed message gets interpolated into an
// HTML email body sent to the seller.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
