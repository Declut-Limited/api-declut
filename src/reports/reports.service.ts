import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Report, ReportDocument, ReportStatus } from './schemas/report.schema';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { CounterService } from '../common/counter/counter.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { toCsv } from '../common/utils/csv.util';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationRecipientType } from '../notifications/schemas/notification.schema';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { DateRangeDto } from '../common/dto/date-range.dto';
import { ListingsService } from '../listings/listings.service';
import { TransactionsService } from '../transactions/transactions.service';

// Proposed field sets, not explicitly pinned down beyond "populated" —
// flag back if these need adjusting once a real UI consumes them.
const POPULATE_FIELDS = {
  listing: 'title slug mainImageUrl',
  user: 'name slug email',
  // No "role" here — User has no role field (only Admin does); status/rating map to accountStatus/avgRating, reshaped in shapeReport().
  reporter: 'name slug accountStatus createdAt avgRating company',
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
    private readonly counterService: CounterService,
    private readonly auditLogService: AuditLogService,
    private readonly notificationsService: NotificationsService,
    private readonly listingsService: ListingsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  // User-facing — a user files their own report directly (no admin
  // authorship anymore, see the removed `createdBy` on the schema).
  async create(
    callerId: string,
    dto: CreateReportDto,
  ): Promise<ReportDocument> {
    if (!dto.listingId && !dto.userId) {
      throw new BadRequestException(
        'A report must reference a listing, a user, or both',
      );
    }
    if (dto.reporterId !== callerId) {
      throw new ForbiddenException('You can only file a report as yourself');
    }

    // Flag the listing before creating the report — a bad listingId fails
    // loudly with nothing dangling, rather than a Report row referencing a
    // listing that was never actually reported.
    if (dto.listingId) {
      await this.listingsService.report(dto.listingId, callerId);
      // If the reporter has an active purchase in progress on this listing,
      // the report also freezes that specific transaction/escrow, giving
      // the seller a chance to respond — see
      // TransactionsService.reportActivePurchase(). A no-op (returns null)
      // when there's no matching active transaction, e.g. a spam listing or
      // one the reporter never bought — the listing still gets reported
      // normally either way. 2026-09-16.
      await this.transactionsService.reportActivePurchase(
        dto.listingId,
        callerId,
      );
    }

    const slug = await this.counterService.nextSlug('report', 'RPT', 4);
    const report = await this.reportModel.create({
      slug,
      reason: dto.reason,
      listing: dto.listingId,
      user: dto.userId,
      reporter: dto.reporterId,
    });

    await this.auditLogService.record({
      entityType: 'report',
      entityId: report._id.toString(),
      event: 'report.created',
      actor: callerId,
      newState: report.status,
    });

    return report;
  }

  async list(dto: ListReportsDto): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter = {
      ...(dto.status ? { status: dto.status } : {}),
      ...buildDateRangeFilter(dto),
    };

    const [found, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .populate('listing', POPULATE_FIELDS.listing)
        .populate('user', POPULATE_FIELDS.user)
        .populate('reporter', POPULATE_FIELDS.reporter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.reportModel.countDocuments(filter),
    ]);

    return {
      results: found.map((r) => this.shapeReport(r)),
      total,
      page,
      limit,
    };
  }

  // Unpaginated (full matching set) and flattened rather than reusing shapeReport() — a nested-object CSV cell is unreadable.
  async exportCsv(
    status?: ReportStatus,
    dateRange: DateRangeDto = {},
  ): Promise<string> {
    const filter = {
      ...(status ? { status } : {}),
      ...buildDateRangeFilter(dateRange),
    };
    const found = await this.reportModel
      .find(filter)
      .populate('listing', POPULATE_FIELDS.listing)
      .populate('user', POPULATE_FIELDS.user)
      .sort({ createdAt: -1 })
      .exec();

    const rows = found.map((r) => {
      const listing = r.listing as unknown as { title?: string } | undefined;
      const user = r.user as unknown as
        { name?: string; email?: string } | undefined;
      return {
        slug: r.slug,
        reason: r.reason,
        listingTitle: listing?.title ?? '',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
        status: r.status,
        createdAt: r.createdAt,
      };
    });

    return toCsv(rows, [
      'slug',
      'reason',
      'listingTitle',
      'userName',
      'userEmail',
      'status',
      'createdAt',
    ]);
  }

  async findBySlug(slug: string): Promise<Record<string, unknown>> {
    const report = await this.reportModel
      .findOne({ slug })
      .populate('listing', POPULATE_FIELDS.listing)
      .populate('user', POPULATE_FIELDS.user)
      .populate('reporter', POPULATE_FIELDS.reporter)
      .exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return this.shapeReport(report);
  }

  async updateStatus(
    id: string,
    adminId: string,
    status: ReportStatus,
  ): Promise<ReportDocument> {
    const report = await this.reportModel.findById(id).exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    const oldState = report.status;
    report.status = status;
    await report.save();

    await this.auditLogService.record({
      entityType: 'report',
      entityId: id,
      event: 'report.status_updated',
      actor: adminId,
      oldState,
      newState: status,
    });

    if (status === ReportStatus.RESOLVED) {
      await this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: report.reporter.toString(),
        type: 'report_resolved',
        title: 'Your report has been resolved',
        body: `Your report (${report.slug}) has been resolved.`,
      });
    }

    return report;
  }

  // Raw fetch by id, no populate/shaping — used by DisputesService.create(),
  // which takes reportId directly from the client and cross-checks it
  // against the transaction itself. A malformed id 404s here rather than
  // throwing a raw Mongoose CastError. 2026-09-16.
  async getRawById(id: string): Promise<ReportDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Report not found');
    }
    const report = await this.reportModel.findById(id).exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  // Called by DisputesService right after a Dispute document is created —
  // links the two records and moves the report out of NEW so it shows as
  // actively being handled, not just sitting new/unread. 2026-09-16.
  async attachDispute(reportId: string, disputeId: string): Promise<void> {
    await this.reportModel.updateOne(
      { _id: reportId },
      { sellerDispute: disputeId, status: ReportStatus.INVESTIGATING },
    );
  }

  // Requires listing/user/reporter already populated on the query that fetched `report`.
  private shapeReport(report: ReportDocument): Record<string, unknown> {
    const obj = report.toObject() as unknown as Record<string, unknown>;
    if (obj.listing && typeof obj.listing === 'object') {
      const listing = obj.listing as { mainImageUrl?: string };
      const { mainImageUrl, ...rest } = listing;
      obj.listing = { ...rest, mainImage: mainImageUrl };
    }
    if (obj.reporter && typeof obj.reporter === 'object') {
      const reporter = obj.reporter as {
        accountStatus?: string;
        avgRating?: number;
      };
      const { accountStatus, avgRating, ...rest } = reporter;
      obj.reporter = { ...rest, status: accountStatus, rating: avgRating };
    }
    return obj;
  }
}
