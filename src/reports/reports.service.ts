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

// accusedUser and reporter share one shape — explicit instruction, 2026-09-17
// ("populate the user just like we did for the reporter, now include their
// both emails and phone numbers"). No "role" here — User has no role field
// (only Admin does); status/rating map to accountStatus/avgRating, reshaped
// in shapeReport() for both. No "company" either — that field exists on the
// User schema but no onboarding flow ever sets it (see the schema's own
// comment), so it's always undefined in practice; dropped the same day,
// explicit instruction ("we don't have that").
const PARTY_FIELDS = 'name slug email phone accountStatus createdAt avgRating';
const POPULATE_FIELDS = {
  listing: 'title slug mainImageUrl',
  accusedUser: PARTY_FIELDS,
  reporter: PARTY_FIELDS,
  // Detail-view-only shape (list/findBySlug) — just the dispute's own
  // narrative content, not seller/transaction/report (already known from
  // the Report itself). Explicit instruction, 2026-09-17.
  sellerDispute: 'disputeClaim evidenceImages evidenceVideo',
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
    if (!dto.listingId && !dto.accusedUserId) {
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
      accusedUser: dto.accusedUserId,
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
        .populate('accusedUser', POPULATE_FIELDS.accusedUser)
        .populate('reporter', POPULATE_FIELDS.reporter)
        .populate('sellerDispute', POPULATE_FIELDS.sellerDispute)
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
      .populate('accusedUser', POPULATE_FIELDS.accusedUser)
      .sort({ createdAt: -1 })
      .exec();

    const rows = found.map((r) => {
      const listing = r.listing as unknown as { title?: string } | undefined;
      const accusedUser = r.accusedUser as unknown as
        { name?: string; email?: string } | undefined;
      return {
        slug: r.slug,
        reason: r.reason,
        listingTitle: listing?.title ?? '',
        accusedUserName: accusedUser?.name ?? '',
        accusedUserEmail: accusedUser?.email ?? '',
        status: r.status,
        createdAt: r.createdAt,
      };
    });

    return toCsv(rows, [
      'slug',
      'reason',
      'listingTitle',
      'accusedUserName',
      'accusedUserEmail',
      'status',
      'createdAt',
    ]);
  }

  async findBySlug(slug: string): Promise<Record<string, unknown>> {
    const report = await this.reportModel
      .findOne({ slug })
      .populate('listing', POPULATE_FIELDS.listing)
      .populate('accusedUser', POPULATE_FIELDS.accusedUser)
      .populate('reporter', POPULATE_FIELDS.reporter)
      .populate('sellerDispute', POPULATE_FIELDS.sellerDispute)
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
  // links the two records and moves the report to DISPUTED, the only status
  // a report can ever have a sellerDispute under. 2026-09-16, status target
  // corrected 2026-09-17 (was INVESTIGATING, back when that was the
  // "still open" catch-all rather than the true starting state).
  async attachDispute(reportId: string, disputeId: string): Promise<void> {
    await this.reportModel.updateOne(
      { _id: reportId },
      { sellerDispute: disputeId, status: ReportStatus.DISPUTED },
    );
  }

  // Requires listing/accusedUser/reporter already populated on the query that fetched `report`.
  private shapeReport(report: ReportDocument): Record<string, unknown> {
    const obj = report.toObject() as unknown as Record<string, unknown>;
    if (obj.listing && typeof obj.listing === 'object') {
      const listing = obj.listing as { mainImageUrl?: string };
      const { mainImageUrl, ...rest } = listing;
      obj.listing = { ...rest, mainImage: mainImageUrl };
    }
    // accusedUser and reporter share the same raw populated shape (see
    // PARTY_FIELDS) so both get the identical accountStatus/avgRating reshape.
    for (const key of ['accusedUser', 'reporter'] as const) {
      const party = obj[key];
      if (party && typeof party === 'object') {
        const { accountStatus, avgRating, ...rest } = party as {
          accountStatus?: string;
          avgRating?: number;
        };
        obj[key] = { ...rest, status: accountStatus, rating: avgRating };
      }
    }
    return obj;
  }
}
