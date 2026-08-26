import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { ListingsService } from '../listings/listings.service';
import { ListingStatus } from '../listings/schemas/listing.schema';
import type { UpdateListingDto } from '../listings/dto/update-listing.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionStatus } from '../transactions/schemas/transaction.schema';
import { OffersService } from '../offers/offers.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ReviewStatus } from '../reviews/schemas/review.schema';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { KycService } from '../kyc/kyc.service';
import { KycStatus } from '../users/schemas/user.schema';
import { SettingsService } from '../settings/settings.service';
import { UpdateAppSettingsDto } from '../settings/dto/update-app-settings.dto';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import type { AdminDocument } from '../admin-auth/schemas/admin.schema';
import { EmailService } from '../email/email.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  AdminListListingsDto,
  AdminListReviewsDto,
  AdminListTransactionsDto,
  AdminListUsersDto,
  TransactionTab,
} from './dto/admin-list.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { EmailSellerDto } from './dto/email-seller.dto';
import type { DashboardInsightsFilter } from './dto/dashboard.dto';
import { toCsv } from '../common/utils/csv.util';
import { countTrend } from '../common/utils/trend.util';

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
    private readonly auditLogService: AuditLogService,
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
      slug?: string;
      name: string;
      email: string;
      role: string;
      roleId?: string;
      roleName?: string;
      listingsCount: number;
      status: string;
      joinedAt: Date;
    };

    const userRows: Row[] = users.map((u) => ({
      type: 'user' as const,
      id: u._id.toString(),
      slug: u.slug,
      name: u.name,
      email: u.email,
      role: 'User',
      listingsCount: listingCounts.get(u._id.toString())?.total ?? 0,
      status: u.accountStatus,
      joinedAt: (u as unknown as { createdAt: Date }).createdAt,
    }));

    const adminRows: Row[] = admins.map((a) => {
      const populatedRole = a.role as unknown as
        { _id: { toString(): string }; name: string } | undefined;

      return {
        type: 'admin' as const,
        id: a._id.toString(),
        name: a.name,
        email: a.email,
        slug: a.slug,

        role: 'Admin',
        roleId: populatedRole?._id?.toString(),
        roleName: populatedRole?.name,
        listingsCount: 0,
        status: 'active',
        joinedAt: (a as unknown as { createdAt: Date }).createdAt,
      };
    });

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
      // `role` here is the literal account type (matches 'User' above) —
      // NOT the same thing as `assignedRole`, which is the actual Role
      // document (see src/roles/) this admin's access comes from. title is
      // still just a free-text job label, unrelated to either.
      const assignedRole = admin.role as unknown as
        | {
            _id: { toString(): string };
            name: string;
            permissions: unknown;
          }
        | undefined;
      return {
        type: 'admin' as const,
        details: {
          role: 'Admin',
          slug: admin.slug,
          title: admin.title,
          status: 'active',
          company: admin.company,
          createdAt: (admin as unknown as { createdAt: Date }).createdAt,
          email: admin.email,
          assignedRole: assignedRole
            ? {
                id: assignedRole._id.toString(),
                name: assignedRole.name,
                permissions: assignedRole.permissions,
              }
            : null,
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
    return this.shapeListingDetail(listing, recentActivity);
  }

  async getListingById(id: string) {
    const { listing, recentActivity } =
      await this.listingsService.adminFindByIdDetail(id);
    return this.shapeListingDetail(listing, recentActivity);
  }

  private async shapeListingDetail(
    listing: Awaited<ReturnType<ListingsService['adminFindBySlug']>>['listing'],
    recentActivity: Awaited<
      ReturnType<ListingsService['adminFindBySlug']>
    >['recentActivity'],
  ) {
    const sellerId = listing.seller.toString();
    const [seller, listingCounts] = await Promise.all([
      this.usersService.findById(sellerId),
      this.listingsService.countsBySeller([sellerId]),
    ]);

    return {
      id: listing._id.toString(),
      slug: listing.slug,
      images: listing.images.map((url) => ({ url })),
      title: listing.title,
      status: listing.status,
      category: listing.category,
      createdAt: (listing as unknown as { createdAt: Date }).createdAt,
      views: listing.views,
      saves: listing.saves,
      price: listing.price,
      address: listing.locationLabel,
      location: listing.location,
      locationLabel: listing.locationLabel,
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

  adminUpdateListing(id: string, adminId: string, dto: UpdateListingDto) {
    return this.listingsService.adminUpdate(id, adminId, dto);
  }

  exportListingsCsv(status?: ListingStatus, search?: string) {
    return this.listingsService.exportCsv(status, search);
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

  unflagListing(id: string, adminId: string) {
    return this.listingsService.unflag(id, adminId);
  }

  delistListing(id: string, adminId: string) {
    return this.listingsService.delist(id, adminId);
  }

  relistListing(id: string, adminId: string) {
    return this.listingsService.relist(id, adminId);
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

  exportReviewsCsv(status?: ReviewStatus) {
    return this.reviewsService.exportCsv(status);
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

  // Spans Users + Listings + Transactions — same "genuine exception, lives here rather than forced into one domain service" reasoning as the Users federation above. No dedicated 'dashboard' RBAC bucket exists, same judgment call already made for Offers, grouped under 'transactions' in the controller.
  // Fixed set of 5 named filters (no more generic today/week/all) — lastMonth/last3Months/thisYear compare against the FULL prior calendar period, not an elapsed-mirrored one, since each is now a discrete, named option rather than an arbitrary rolling window.
  private static resolveRange(
    filter: DashboardInsightsFilter,
    startDate?: string,
    endDate?: string,
  ): { since: Date; until: Date; priorSince: Date; priorUntil: Date } {
    const now = new Date();
    switch (filter) {
      case 'lastMonth': {
        const since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const until = new Date(now.getFullYear(), now.getMonth(), 1);
        const priorSince = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        return { since, until, priorSince, priorUntil: since };
      }
      case 'last3Months': {
        const since = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        const priorSince = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        return { since, until: now, priorSince, priorUntil: since };
      }
      case 'thisYear': {
        const since = new Date(now.getFullYear(), 0, 1);
        const priorSince = new Date(now.getFullYear() - 1, 0, 1);
        return { since, until: now, priorSince, priorUntil: since };
      }
      case 'custom': {
        // endDate is a calendar day, made exclusive-upper-bound by +1 day so that day's own data is included.
        const since = new Date(startDate!);
        const until = new Date(
          new Date(endDate!).getTime() + 24 * 60 * 60 * 1000,
        );
        const elapsedMs = until.getTime() - since.getTime();
        return {
          since,
          until,
          priorSince: new Date(since.getTime() - elapsedMs),
          priorUntil: since,
        };
      }
      case 'thisMonth':
      default: {
        const since = new Date(now.getFullYear(), now.getMonth(), 1);
        const priorSince = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return { since, until: now, priorSince, priorUntil: since };
      }
    }
  }

  // "{count} {periodLabel}" phrasing for the two plain-count cards — matches the dashboard mock exactly (e.g. "840 this month"), no invented words.
  private static readonly FILTER_LABELS: Record<
    DashboardInsightsFilter,
    string
  > = {
    thisMonth: 'this month',
    lastMonth: 'last month',
    last3Months: 'in the last 3 months',
    thisYear: 'this year',
    custom: 'in the selected range',
  };

  // 8 cards, each {value, extra: {status, result}} — no chart/donut/activity-feed, explicitly out of scope. Reworked 2026-08-26 for the new 8-card set — all 8 stay scoped to ?filter where a period genuinely applies (numberOfUsers/newListings included: value AND extra both compare the selected period vs the one before it, same as every other filtered card here — reverted an earlier fixed-"this week" version of this that broke that consistency).
  async getDashboardInsights(
    filter: DashboardInsightsFilter = 'thisMonth',
    startDate?: string,
    endDate?: string,
  ) {
    const { since, until, priorSince, priorUntil } = AdminService.resolveRange(
      filter,
      startDate,
      endDate,
    );
    const periodLabel = AdminService.FILTER_LABELS[filter];

    const [
      numberOfUsers,
      priorNumberOfUsers,
      newListings,
      priorNewListings,
      txSummary,
    ] = await Promise.all([
      this.usersService.countNewInPeriod(since, until),
      this.usersService.countNewInPeriod(priorSince, priorUntil),
      this.listingsService.countCreatedInRange(since, until),
      this.listingsService.countCreatedInRange(priorSince, priorUntil),
      this.transactionsService.getDashboardInsights(
        since,
        until,
        priorSince,
        priorUntil,
      ),
    ]);

    return {
      filter,
      since,
      until,
      cards: {
        numberOfUsers: {
          value: numberOfUsers,
          extra: countTrend(
            numberOfUsers,
            periodLabel,
            priorNumberOfUsers,
            true,
          ),
        },
        newListings: {
          value: newListings,
          extra: countTrend(newListings, periodLabel, priorNewListings, true),
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

  // Backs the admin Dashboard "listings per month" chart — 6 months (5 back + current), by listing.price, not a count (per your read of the mock). extra is a plain "+{count} this month" new-listings count, not a trend comparison — matches the mock's single green indicator.
  async getListingsPerMonth() {
    const [totalListingsValue, trend] = await Promise.all([
      this.listingsService.sumTotalValue(),
      this.listingsService.sumValueByMonth(6),
    ]);

    return { totalListingsValue, trend };
  }

  getCategoryDistribution() {
    return this.transactionsService.getCategoryDistribution();
  }

  getTransactionStatusBreakdown() {
    return this.transactionsService.getStatusBreakdown();
  }

  // 'system' for non-human-triggered events; otherwise an id in either User or Admin — same federated-lookup shape as getUserOrAdminDetail() above, since AuditLog.actor has no ref (see the schema comment).
  // Backs the admin Dashboard "recent activity" panel — the 3 most recent AuditLog entries. Bug fix (2026-08-26): this used to call the raw list() + its own resolveActorName() (a bare actorName string, no slug/label/target), which meant this panel's shape silently drifted from GET /admin/activity-log's (which uses listWithDetails()) — same underlying data, different shape. Now shares listWithDetails() so both surfaces return identical per-entry shape (slug, label, target, full actor object), just a top-3 slice here vs. a paginated list there.
  async getRecentActivity() {
    const { results } = await this.auditLogService.listWithDetails(1, 3);
    return { entries: results };
  }
}

// Minimal escaping — the admin-composed message gets interpolated into an HTML email body sent to the seller.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
