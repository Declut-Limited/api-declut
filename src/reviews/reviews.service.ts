import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Review, ReviewDocument, ReviewStatus } from './schemas/review.schema';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { UsersService } from '../users/users.service';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { DateRangeDto } from '../common/dto/date-range.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationRecipientType } from '../notifications/schemas/notification.schema';
import { AuditLogService } from '../audit-log/audit-log.service';
import { toCsv } from '../common/utils/csv.util';

const REVIEWER_POPULATE_FIELDS = 'name email slug company accountStatus image';
const REVIEW_LISTING_POPULATE_FIELDS = 'title mainImageUrl slug createdAt';

interface PopulatedReviewer {
  _id: Types.ObjectId;
  name: string;
  email: string;
  slug?: string;
  company?: string;
  accountStatus: string;
  image?: string;
}

interface PopulatedReviewListing {
  _id: Types.ObjectId;
  title: string;
  mainImageUrl?: string;
  slug?: string;
  createdAt: Date;
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private reviewModel: Model<ReviewDocument>,
    private readonly transactionsService: TransactionsService,
    private readonly usersService: UsersService,
    private readonly trustScoreService: TrustScoreService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Buyer reviews the seller of a specific listing they bought — not tied to
  // a transaction id (the client often won't have it handy) or bidirectional
  // (sellers don't review buyers). Eligibility: reviewerId must have a
  // COMPLETED transaction for this exact listing.
  async create(reviewerId: string, dto: CreateReviewDto) {
    const purchase = await this.transactionsService.findCompletedPurchase(
      reviewerId,
      dto.listingId,
    );
    if (!purchase) {
      throw new BadRequestException(
        'You can only review a listing you have completed a purchase for',
      );
    }

    let review: ReviewDocument;
    try {
      review = await this.reviewModel.create({
        listing: dto.listingId,
        reviewer: reviewerId,
        reviewee: purchase.sellerId,
        rating: dto.rating,
        comment: dto.comment,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('You have already reviewed this listing');
      }
      throw err;
    }

    await this.recalculate(purchase.sellerId);

    await this.notificationsService.notifyUser(purchase.sellerId, {
      title: 'New review received',
      body: `You received a ${dto.rating}-star review.`,
      data: { type: 'review_received', reviewId: review._id.toString() },
    });

    return review.toObject();
  }

  // The caller's own reviews left for this seller — potentially more than
  // one, since a buyer can complete multiple separate purchases (and so
  // leave multiple reviews) with the same seller. Scoped to the requester,
  // not a public "everyone's reviews of this seller" feed.
  async listForUser(userId: string, requesterId: string, dto: ListReviewsDto) {
    if (!isValidObjectId(userId)) {
      throw new NotFoundException('User not found');
    }
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter = { reviewee: userId, reviewer: requesterId };

    const [found, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .populate('reviewer', REVIEWER_POPULATE_FIELDS)
        .populate('listing', REVIEW_LISTING_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.reviewModel.countDocuments(filter),
    ]);

    return {
      results: found.map((r) => this.shapeReview(r)),
      total,
      page,
      limit,
    };
  }

  // A listing is only ever bought once, so this is really "does the caller
  // have a review for the one purchase they made of this listing" — at most
  // one result, scoped to the requester (never someone else's review).
  async getForListing(listingId: string, requesterId: string) {
    if (!isValidObjectId(listingId)) {
      throw new NotFoundException('Review not found');
    }
    const review = await this.reviewModel
      .findOne({ listing: listingId, reviewer: requesterId })
      .populate('reviewer', REVIEWER_POPULATE_FIELDS)
      .populate('listing', REVIEW_LISTING_POPULATE_FIELDS);
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    return this.shapeReview(review);
  }

  // Admin-only lookup, no reviewer scoping (unlike getForListing() above) —
  // a listing is only ever bought/reviewed once, so this is just "does a
  // review exist for this listing at all." Backs the buyerReview shown on
  // the admin listing detail view for a SOLD listing. Returns null rather
  // than throwing — a sold listing may simply not have been reviewed yet.
  // 2026-09-17, explicit instruction. `user` (the reviewer/buyer) added the
  // same day, second pass — `averageRating` is deliberately its own name,
  // distinct from the review's own `rating` field right next to it.
  async getForListingAdmin(listingId: string): Promise<{
    _id: string;
    rating: number;
    comment?: string;
    status: ReviewStatus;
    user: {
      _id: string;
      name: string;
      averageRating: number;
      slug?: string;
      email: string;
    } | null;
  } | null> {
    if (!isValidObjectId(listingId)) {
      return null;
    }
    const review = await this.reviewModel
      .findOne({ listing: listingId })
      .select('rating comment status reviewer')
      .populate('reviewer', 'name email slug avgRating')
      .exec();
    if (!review) {
      return null;
    }
    const reviewer = review.reviewer as unknown as {
      _id: Types.ObjectId;
      name: string;
      email: string;
      slug?: string;
      avgRating: number;
    } | null;
    return {
      _id: review._id.toString(),
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      user: reviewer
        ? {
            _id: reviewer._id.toString(),
            name: reviewer.name,
            averageRating: reviewer.avgRating,
            slug: reviewer.slug,
            email: reviewer.email,
          }
        : null,
    };
  }

  // Unpaginated (full matching set) and flattened rather than reusing shapeReview() — a nested-object CSV cell is unreadable.
  async exportCsv(
    status?: ReviewStatus,
    dateRange: DateRangeDto = {},
  ): Promise<string> {
    const filter = {
      ...(status ? { status } : {}),
      ...buildDateRangeFilter(dateRange),
    };
    const found = await this.reviewModel
      .find(filter)
      .populate('reviewer', REVIEWER_POPULATE_FIELDS)
      .populate('listing', REVIEW_LISTING_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .exec();

    const rows = found.map((r) => {
      const reviewer = r.reviewer as unknown as PopulatedReviewer;
      const listing = r.listing as unknown as PopulatedReviewListing;
      return {
        id: r._id.toString(),
        listingTitle: listing?.title ?? '',
        reviewerName: reviewer?.name ?? '',
        reviewerEmail: reviewer?.email ?? '',
        rating: r.rating,
        comment: r.comment ?? '',
        status: r.status,
        createdAt: r.createdAt,
      };
    });

    return toCsv(rows, [
      'id',
      'listingTitle',
      'reviewerName',
      'reviewerEmail',
      'rating',
      'comment',
      'status',
      'createdAt',
    ]);
  }

  // Admin moderation list — populates reviewer and listing so an admin can
  // see who wrote what about which item without a follow-up lookup.
  async adminList(
    page: number,
    limit: number,
    status?: ReviewStatus,
    dateRange: DateRangeDto = {},
  ): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = {
      ...(status ? { status } : {}),
      ...buildDateRangeFilter(dateRange),
    };
    const [found, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .populate('reviewer', REVIEWER_POPULATE_FIELDS)
        .populate('listing', REVIEW_LISTING_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.reviewModel.countDocuments(filter),
    ]);
    return {
      results: found.map((r) => this.shapeReview(r)),
      total,
      page,
      limit,
    };
  }

  async adminFlag(reviewId: string, adminId: string): Promise<ReviewDocument> {
    const review = await this.findByIdOrThrow(reviewId);
    const oldState = review.status;
    review.status = ReviewStatus.FLAGGED;
    await review.save();
    await this.auditLogService.record({
      entityType: 'review',
      entityId: reviewId,
      event: 'review.flagged',
      actor: adminId,
      oldState,
      newState: review.status,
    });

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: review.reviewee.toString(),
      type: 'review_flagged',
      title: 'A review about you was flagged',
      body: 'An admin flagged a review on your profile for attention.',
    });

    return review;
  }

  // Keeps the review, just marks the flag as handled — admin review removal
  // no longer exists at all (2026-09-17, explicit instruction).
  async adminResolve(
    reviewId: string,
    adminId: string,
  ): Promise<ReviewDocument> {
    const review = await this.findByIdOrThrow(reviewId);
    const oldState = review.status;
    review.status = ReviewStatus.RESOLVED;
    await review.save();
    await this.auditLogService.record({
      entityType: 'review',
      entityId: reviewId,
      event: 'review.resolved',
      actor: adminId,
      oldState,
      newState: review.status,
    });
    return review;
  }

  private async findByIdOrThrow(reviewId: string): Promise<ReviewDocument> {
    if (!isValidObjectId(reviewId)) {
      throw new NotFoundException('Review not found');
    }
    const review = await this.reviewModel.findById(reviewId);
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    return review;
  }

  private async recalculate(userId: string): Promise<void> {
    const stats = await this.reviewModel.aggregate<{
      _id: null;
      avgRating: number;
      count: number;
    }>([
      { $match: { reviewee: new Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);

    const avgRating = stats[0]?.avgRating ?? 0;
    const reviewCount = stats[0]?.count ?? 0;
    await this.usersService.setRatingStats(
      userId,
      Math.round(avgRating * 10) / 10,
      reviewCount,
    );

    // avgRating feeds the trust score formula — recalculate after it changes.
    await this.trustScoreService.recalculate(userId);
  }

  // Requires reviewer + listing already populated on the query that fetched
  // `review`.
  private shapeReview(review: ReviewDocument): Record<string, unknown> {
    const obj = review.toObject() as unknown as Record<string, unknown>;
    // A referenced User/Listing can be gone by the time this is read (a hard
    // delete elsewhere, or stale data) — populate() then resolves to null.
    // Degrade to null rather than crash, matching nearby()'s dangling-seller
    // handling elsewhere in this app.
    const reviewer = review.reviewer as unknown as PopulatedReviewer | null;
    obj.reviewer = reviewer
      ? {
          id: reviewer._id.toString(),
          name: reviewer.name,
          email: reviewer.email,
          slug: reviewer.slug,
          company: reviewer.company,
          status: reviewer.accountStatus,
          image: reviewer.image,
        }
      : null;
    const listing = review.listing as unknown as PopulatedReviewListing | null;
    obj.listing = listing
      ? {
          id: listing._id.toString(),
          title: listing.title,
          mainImage: listing.mainImageUrl,
          slug: listing.slug,
          createdAt: listing.createdAt,
        }
      : null;
    return obj;
  }
}
