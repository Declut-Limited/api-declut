import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Feedback,
  FeedbackDocument,
  FeedbackStatus,
  FeedbackType,
} from './schemas/feedback.schema';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { ListAdminFeedbackDto } from './dto/list-admin-feedback.dto';
import { FeedbackAnalyticsPeriod } from './dto/feedback-analytics.dto';
import { CounterService } from '../common/counter/counter.service';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { escapeRegex } from '../common/utils/regex.util';

// A rating of 2.5 or below is "low" — explicit threshold from the product
// ask (ratings are integers 1-5 in practice, so this is effectively <= 2,
// but written as 2.5 to match the stated rule literally).
const LOW_RATING_THRESHOLD = 2.5;

const ADMIN_USER_POPULATE_FIELDS = 'name email slug';

interface TrendBucket {
  label: string;
  start: Date;
  end: Date;
}

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback.name) private feedbackModel: Model<FeedbackDocument>,
    private readonly counterService: CounterService,
  ) {}

  async create(
    userId: string,
    dto: CreateFeedbackDto,
  ): Promise<FeedbackDocument> {
    const slug = await this.counterService.nextSlug('feedback', 'FBK', 4);
    return this.feedbackModel.create({
      slug,
      user: userId,
      type: dto.type,
      feedbackDescription: dto.feedbackDescription,
      canContactMe: dto.canContactMe ?? false,
      screenshot: dto.screenshot,
      experience: dto.experience,
    });
  }

  async listForUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    results: FeedbackDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = { user: new Types.ObjectId(userId) };
    const [results, total] = await Promise.all([
      this.feedbackModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.feedbackModel.countDocuments(filter),
    ]);
    return { results, total, page, limit };
  }

  // Admin — every feedback row, filterable by status/type/search/date range.
  // Shares shapeAdminFeedbackRow() with getRecentAttention()'s recentFeedback
  // — same row shape everywhere admin feedback rows are listed.
  async adminList(dto: ListAdminFeedbackDto): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter: Record<string, unknown> = {
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...buildDateRangeFilter(dto),
    };
    // Case-insensitive substring match against the one free-text field —
    // same convention Listings' search switched to (regex, not $text).
    if (dto.search) {
      filter.feedbackDescription = new RegExp(escapeRegex(dto.search), 'i');
    }

    const [found, total] = await Promise.all([
      this.feedbackModel
        .find(filter)
        .populate('user', ADMIN_USER_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.feedbackModel.countDocuments(filter),
    ]);

    return {
      results: found.map((f) => this.shapeAdminFeedbackRow(f)),
      total,
      page,
      limit,
    };
  }

  // Admin dashboard — 5 sections, all scoped to the same period filter
  // (mirrors the admin dashboard's own thisMonth/lastMonth/last3Months/
  // thisYear/custom filter, plus lastYear which that one doesn't have).
  async getAnalytics(
    period: FeedbackAnalyticsPeriod = 'thisMonth',
    startDate?: string,
    endDate?: string,
  ) {
    const { since, until } = FeedbackService.resolvePeriodRange(
      period,
      startDate,
      endDate,
    );
    const periodFilter = { createdAt: { $gte: since, $lt: until } };
    // The trend chart always runs to the full calendar period (end of
    // month / Dec 31), not just "so far" — an ongoing thisMonth/thisYear
    // still shows its remaining, not-yet-happened days/months as 0 rather
    // than simply not existing on the chart. insights/ratingDistribution/
    // filterByType/filterByStatus above are untouched — they only ever
    // reflect data that's actually happened, bounded by `until`.
    const trendUntil = FeedbackService.resolveTrendUntil(period, since, until);

    const [facet, trend] = await Promise.all([
      this.feedbackModel.aggregate<{
        total: { count: number }[];
        byStatus: { _id: FeedbackStatus; count: number }[];
        byType: { _id: FeedbackType; count: number }[];
        byStar: { _id: number; count: number }[];
        avgRating: { avg: number }[];
      }>([
        { $match: periodFilter },
        {
          $facet: {
            total: [{ $count: 'count' }],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            byType: [{ $group: { _id: '$type', count: { $sum: 1 } } }],
            byStar: [{ $group: { _id: '$experience', count: { $sum: 1 } } }],
            avgRating: [
              { $group: { _id: null, avg: { $avg: '$experience' } } },
            ],
          },
        },
      ]),
      this.buildFeedbackTrend(since, trendUntil),
    ]);

    const { total, byStatus, byType, byStar, avgRating } = facet[0];
    const totalFeedback = total[0]?.count ?? 0;
    const statusCounts = new Map(byStatus.map((r) => [r._id, r.count]));
    const typeCounts = new Map(byType.map((r) => [r._id, r.count]));
    const starCounts = new Map(byStar.map((r) => [r._id, r.count]));
    const averageRating = Math.round((avgRating[0]?.avg ?? 0) * 10) / 10;

    const awaitingReview = statusCounts.get(FeedbackStatus.NEW) ?? 0;
    const resolved = statusCounts.get(FeedbackStatus.RESOLVED) ?? 0;

    return {
      period,
      since,
      until,
      insights: {
        totalFeedback,
        awaitingReview,
        resolved,
        averageRating,
      },
      feedbackTrend: trend,
      ratingDistribution: {
        averageRating,
        totalRatings: totalFeedback,
        ratingByStar: {
          '5_star': starCounts.get(5) ?? 0,
          '4_star': starCounts.get(4) ?? 0,
          '3_star': starCounts.get(3) ?? 0,
          '2_star': starCounts.get(2) ?? 0,
          '1_star': starCounts.get(1) ?? 0,
        },
      },
      filterByType: Object.values(FeedbackType).map((type) => ({
        type,
        count: typeCounts.get(type) ?? 0,
      })),
      filterByStatus: Object.values(FeedbackStatus).map((status) => {
        const count = statusCounts.get(status) ?? 0;
        const percentage =
          totalFeedback === 0
            ? 0
            : Math.round((count / totalFeedback) * 1000) / 10;
        return { status, count, percentage: `${percentage}%` };
      }),
    };
  }

  // Admin dashboard — no period filter, a live snapshot (same "some cards
  // are period-scoped, some are live snapshots" split the main admin
  // dashboard already uses for escrowBalance/pendingInspections/openDisputes).
  async getRecentAttention() {
    const [
      unreviewedReportProblem,
      lowRatedUnresolvedFeedback,
      escalatedToOtherTeam,
      recent,
    ] = await Promise.all([
      this.feedbackModel.countDocuments({
        type: FeedbackType.REPORT_PROBLEM,
        status: FeedbackStatus.NEW,
      }),
      this.feedbackModel.countDocuments({
        experience: { $lte: LOW_RATING_THRESHOLD },
        status: { $ne: FeedbackStatus.RESOLVED },
      }),
      this.feedbackModel.countDocuments({ status: FeedbackStatus.ESCALATED }),
      this.feedbackModel
        .find({})
        .populate('user', ADMIN_USER_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .limit(3)
        .exec(),
    ]);

    return {
      needsAttention: {
        unreviewedReportProblem,
        lowRatedUnresolvedFeedback,
        escalatedToOtherTeam,
      },
      recentFeedback: recent.map((f) => this.shapeAdminFeedbackRow(f)),
    };
  }

  // Shared by adminList() and getRecentAttention() — one row shape
  // everywhere admin-facing feedback is listed. Reshapes experience -> rating
  // (matching the admin-facing wording) and adds isLowRated, same "reshape
  // at the response layer, keep the schema field name as-is" pattern
  // ReportsService.shapeReport() already uses for accountStatus/avgRating.
  private shapeAdminFeedbackRow(
    doc: FeedbackDocument,
  ): Record<string, unknown> {
    const obj = doc.toObject() as unknown as Record<string, unknown> & {
      _id: Types.ObjectId;
      experience: number;
      user?: unknown;
    };
    const { _id, experience, user, __v, ...rest } = obj as Record<
      string,
      unknown
    > & { _id: Types.ObjectId; experience: number; __v?: unknown };
    void __v;

    let shapedUser = user;
    if (user && typeof user === 'object') {
      const u = user as {
        _id?: Types.ObjectId;
        name?: string;
        email?: string;
        slug?: string;
      };
      shapedUser = {
        id: u._id?.toString(),
        name: u.name,
        email: u.email,
        slug: u.slug,
      };
    }

    return {
      id: _id.toString(),
      ...rest,
      rating: experience,
      isLowRated: experience <= LOW_RATING_THRESHOLD,
      user: shapedUser,
    };
  }

  private async buildFeedbackTrend(
    since: Date,
    until: Date,
  ): Promise<{ label: string; submitted: number; resolved: number }[]> {
    const buckets = FeedbackService.buildTrendBuckets(since, until);

    const [submittedDocs, resolvedDocs] = await Promise.all([
      this.feedbackModel
        .find({ createdAt: { $gte: since, $lt: until } }, { createdAt: 1 })
        .lean(),
      this.feedbackModel
        .find(
          {
            status: FeedbackStatus.RESOLVED,
            updatedAt: { $gte: since, $lt: until },
          },
          { updatedAt: 1 },
        )
        .lean(),
    ]);

    return buckets.map((bucket) => ({
      label: bucket.label,
      submitted: submittedDocs.filter(
        (d) => d.createdAt >= bucket.start && d.createdAt < bucket.end,
      ).length,
      // updatedAt is a proxy for "when it was resolved" — there's no
      // dedicated resolvedAt field, same honesty-flagged proxy the revenue
      // trends chart already uses for "when a transaction completed".
      resolved: resolvedDocs.filter(
        (d) => d.updatedAt >= bucket.start && d.updatedAt < bucket.end,
      ).length,
    }));
  }

  // Granularity scales with the span so a chart never renders 1 point or
  // 300 points: <=31 days -> daily, <=120 days -> weekly, else monthly.
  // Not specified in the request — a judgment call, flagged.
  private static buildTrendBuckets(since: Date, until: Date): TrendBucket[] {
    const spanMs = until.getTime() - since.getTime();
    const spanDays = Math.max(1, Math.ceil(spanMs / (24 * 60 * 60 * 1000)));
    const dayFmt = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const monthFmt = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
    });

    const buckets: TrendBucket[] = [];

    if (spanDays <= 31) {
      let cursor = new Date(
        since.getFullYear(),
        since.getMonth(),
        since.getDate(),
      );
      while (cursor < until) {
        const start = cursor;
        const end = new Date(
          start.getFullYear(),
          start.getMonth(),
          start.getDate() + 1,
        );
        buckets.push({ label: dayFmt.format(start), start, end });
        cursor = end;
      }
      return buckets;
    }

    if (spanDays <= 120) {
      let cursor = new Date(since);
      while (cursor < until) {
        const start = cursor;
        const end = new Date(
          Math.min(start.getTime() + 7 * 24 * 60 * 60 * 1000, until.getTime()),
        );
        const label = `${dayFmt.format(start)} - ${dayFmt.format(new Date(end.getTime() - 1))}`;
        buckets.push({ label, start, end });
        cursor = end;
      }
      return buckets;
    }

    let cursor = new Date(since.getFullYear(), since.getMonth(), 1);
    while (cursor < until) {
      const start = cursor;
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      buckets.push({ label: monthFmt.format(start), start, end });
      cursor = end;
    }
    return buckets;
  }

  // Mirrors AdminService.resolveRange()'s named-period shape (kept as a
  // separate, local implementation rather than a shared util — this one
  // needs no prior-period comparison, and adds lastYear on explicit request).
  private static resolvePeriodRange(
    period: FeedbackAnalyticsPeriod,
    startDate?: string,
    endDate?: string,
  ): { since: Date; until: Date } {
    const now = new Date();
    switch (period) {
      case 'lastMonth': {
        const since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const until = new Date(now.getFullYear(), now.getMonth(), 1);
        return { since, until };
      }
      case 'last3Months': {
        const since = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        return { since, until: now };
      }
      case 'thisYear': {
        const since = new Date(now.getFullYear(), 0, 1);
        return { since, until: now };
      }
      case 'lastYear': {
        const since = new Date(now.getFullYear() - 1, 0, 1);
        const until = new Date(now.getFullYear(), 0, 1);
        return { since, until };
      }
      case 'custom': {
        const since = new Date(startDate!);
        const until = new Date(
          new Date(endDate!).getTime() + 24 * 60 * 60 * 1000,
        );
        return { since, until };
      }
      case 'thisMonth':
      default: {
        const since = new Date(now.getFullYear(), now.getMonth(), 1);
        return { since, until: now };
      }
    }
  }

  // thisMonth/thisYear are the only two periods that are both "ongoing"
  // (their real until is `now`, mid-period) and tied to a calendar unit
  // with a known future end — so only these two get widened for the trend
  // chart, to the first moment of the next month/year respectively.
  // lastMonth/lastYear are already fully-elapsed periods (until IS their
  // real end); last3Months/custom are rolling/arbitrary ranges with no
  // "complete the period" concept to extend to.
  private static resolveTrendUntil(
    period: FeedbackAnalyticsPeriod,
    since: Date,
    until: Date,
  ): Date {
    switch (period) {
      case 'thisMonth':
        return new Date(since.getFullYear(), since.getMonth() + 1, 1);
      case 'thisYear':
        return new Date(since.getFullYear() + 1, 0, 1);
      default:
        return until;
    }
  }
}
