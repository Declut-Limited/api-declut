import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types, isValidObjectId } from 'mongoose';
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
import { SettingsService } from '../settings/settings.service';

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
  // Detail-view-only shape (list/findByIdOrSlug) — just the dispute's own
  // narrative content, not seller/transaction/report (already known from
  // the Report itself). Explicit instruction, 2026-09-17.
  sellerDispute: 'disputeClaim evidenceImages evidenceVideo',
  attendingAdmin: 'name slug',
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
    private readonly settingsService: SettingsService,
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

    // accusedUserId derived from the listing's own seller when a listing is
    // given — explicit instruction, 2026-09-17 — a client-supplied value is
    // only used for the no-listing, report-a-user-directly case.
    let accusedUserId = dto.accusedUserId;

    // Flag the listing before creating the report — a bad listingId fails
    // loudly with nothing dangling, rather than a Report row referencing a
    // listing that was never actually reported.
    if (dto.listingId) {
      const listing = await this.listingsService.report(
        dto.listingId,
        callerId,
      );
      accusedUserId = listing.seller.toString();
    }

    // Freezes the named transaction/escrow directly, giving the seller a
    // chance to respond — see TransactionsService.reportPurchase(). Throws
    // (403/400) if the transaction isn't the reporter's own, or isn't in a
    // reportable state — explicit instruction, 2026-09-17: the client now
    // names the exact transaction, so an ineligible one is a real error,
    // not a silent no-op.
    if (dto.transactionId) {
      await this.transactionsService.reportPurchase(
        dto.transactionId,
        callerId,
        dto.listingId,
      );
    }

    // Seller-response SLA — starts counting the instant a buyer's report is
    // created (explicit instruction, 2026-09-19: "SLA starts counting once
    // buyer drops a report"), regardless of whether it's transaction-linked.
    // sellerResponseSlaTimeInHour is snapshotted here so a later admin
    // change to the setting never retroactively moves this report's
    // already-running deadline.
    const settings = await this.settingsService.get();
    const slaFields = settings.enableSellerSLA
      ? {
          sellerResponseSlaTimeInHour: settings.sellerResponseSlaTimeInHour,
          sellerResponseDeadlineAt: new Date(
            Date.now() + settings.sellerResponseSlaTimeInHour * 60 * 60 * 1000,
          ),
        }
      : {};

    const slug = await this.counterService.nextSlug('report', 'RPT', 4);
    const report = await this.reportModel.create({
      slug,
      reason: dto.reason,
      listing: dto.listingId,
      transaction: dto.transactionId,
      accusedUser: accusedUserId,
      reporter: dto.reporterId,
      ...slaFields,
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
        .populate('attendingAdmin', POPULATE_FIELDS.attendingAdmin)
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

  // Merged from separate by-id/by-slug lookups — explicit instruction,
  // 2026-09-19. Same isValidObjectId dispatch every other merged detail
  // route in this app already uses.
  async findByIdOrSlug(idOrSlug: string): Promise<Record<string, unknown>> {
    const filter = isValidObjectId(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: idOrSlug };
    const report = await this.reportModel
      .findOne(filter)
      .populate('listing', POPULATE_FIELDS.listing)
      .populate('accusedUser', POPULATE_FIELDS.accusedUser)
      .populate('reporter', POPULATE_FIELDS.reporter)
      .populate('sellerDispute', POPULATE_FIELDS.sellerDispute)
      .populate('attendingAdmin', POPULATE_FIELDS.attendingAdmin)
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
    await this.claimAttendingAdmin(id, adminId);
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
      {
        sellerDispute: disputeId,
        status: ReportStatus.DISPUTED,
        // Seller responded (by disputing) — the response window is over.
        slaPeriodEnded: true,
      },
    );
  }

  // Three ways to resolve a report whose transaction reached DISPUTED —
  // moved here from the Transactions/Admin surface (explicit instruction,
  // 2026-09-17 — "this is a report feature not just a transaction feature,
  // it is a way to resolve reports"). Each resolves via the report's own
  // `transaction` field (set at creation time from CreateReportDto.transactionId)
  // rather than requiring the caller to know the transaction id — the
  // actual business logic (money movement, listing/trust-score effects,
  // status transitions) is unchanged, still owned by TransactionsService.
  async resolveRelease(reportId: string, adminId: string) {
    const report = await this.getReportForResolve(reportId, adminId);
    return this.transactionsService.adminRelease(
      report.transaction!.toString(),
      adminId,
    );
  }

  async resolveRefund(reportId: string, adminId: string, reason?: string) {
    const report = await this.getReportForResolve(reportId, adminId);
    return this.transactionsService.adminRefund(
      report.transaction!.toString(),
      adminId,
      reason,
    );
  }

  async resolveDelistAndRefund(
    reportId: string,
    adminId: string,
    reason?: string,
  ) {
    const report = await this.getReportForResolve(reportId, adminId);
    return this.transactionsService.adminDelistAndRefund(
      report.transaction!.toString(),
      adminId,
      reason,
    );
  }

  private async getReportForResolve(
    reportId: string,
    adminId: string,
  ): Promise<ReportDocument> {
    await this.claimAttendingAdmin(reportId, adminId);
    const report = await this.getRawById(reportId);
    if (!report.transaction) {
      throw new BadRequestException(
        'This report has no associated transaction to resolve',
      );
    }
    return report;
  }

  // First admin to take any mutating action on a report claims it — no
  // separate "attend" endpoint, explicit instruction, 2026-09-19 ("any admin
  // who first makes an action is the attendingAdmin on this case"). Atomic
  // (only succeeds while attendingAdmin is still unset), so two admins
  // racing on the same report can't both win it. Once claimed, a different
  // admin is blocked outright from acting further; the same admin who
  // already owns it can keep acting freely.
  private async claimAttendingAdmin(
    reportId: string,
    adminId: string,
  ): Promise<void> {
    const claimed = await this.reportModel
      .findOneAndUpdate(
        { _id: reportId, attendingAdmin: { $exists: false } },
        { attendingAdmin: adminId },
      )
      .exec();
    if (claimed) {
      return;
    }

    const report = await this.reportModel
      .findById(reportId)
      .populate('attendingAdmin', 'name')
      .exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    const attending = report.attendingAdmin as unknown as
      { _id: Types.ObjectId; name: string } | undefined;
    if (attending && attending._id.toString() !== adminId) {
      throw new ConflictException(
        `${attending.name} is already attending to this report`,
      );
    }
  }

  // Seller-response SLA reminder — gated by both settings toggles
  // (enableSellerSLA master switch, sendSlaReminderBeforeDeadline). No
  // auto-escalation branch: that was explicitly dropped, so nothing happens
  // automatically once the deadline itself passes — this only ever sends
  // the one pre-deadline nudge, to the accused user (the "seller"), and
  // marks reminderSentAt so it never resends. 2026-09-19.
  @Cron(CronExpression.EVERY_HOUR)
  async sweepSlaReminders(): Promise<void> {
    const settings = await this.settingsService.get();
    if (!settings.enableSellerSLA || !settings.sendSlaReminderBeforeDeadline) {
      return;
    }

    const reminderWindowEnd = new Date(
      Date.now() + settings.reminderSlaTimeInHour * 60 * 60 * 1000,
    );
    const reports = await this.reportModel
      .find({
        status: ReportStatus.INVESTIGATING,
        slaPeriodEnded: false,
        accusedUser: { $exists: true },
        sellerResponseDeadlineAt: {
          $exists: true,
          $gt: new Date(),
          $lte: reminderWindowEnd,
        },
        reminderSentAt: { $exists: false },
      })
      .exec();

    for (const report of reports) {
      await this.notificationsService.notify({
        recipientType: NotificationRecipientType.USER,
        recipientId: report.accusedUser!.toString(),
        type: 'seller_response_sla_reminder',
        title: 'Respond before your deadline',
        body: `You have a pending report (${report.slug}) — please respond before your response window closes.`,
        data: { reportId: report._id.toString() },
      });
      report.reminderSentAt = new Date();
      await report.save();
    }
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
