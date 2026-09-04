import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  Review,
  ReviewDocument,
  ReviewerRole,
  ReviewStatus,
} from './schemas/review.schema';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionStatus } from '../transactions/schemas/transaction.schema';
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

  async create(reviewerId: string, dto: CreateReviewDto) {
    // findForUser already throws ForbiddenException if reviewerId isn't the
    // buyer or seller on this transaction — the same object-level check
    // every other module uses, reused rather than re-implemented here.
    const transaction = await this.transactionsService.findForUser(
      dto.transactionId,
      reviewerId,
    );

    if (transaction.status !== TransactionStatus.COMPLETED) {
      throw new BadRequestException(
        'Only a completed transaction can be reviewed',
      );
    }

    const isBuyer = transaction.buyer.toString() === reviewerId;
    const role = isBuyer ? ReviewerRole.BUYER : ReviewerRole.SELLER;
    const reviewee = isBuyer
      ? transaction.seller.toString()
      : transaction.buyer.toString();

    let review: ReviewDocument;
    try {
      review = await this.reviewModel.create({
        transaction: dto.transactionId,
        listing: transaction.listing,
        reviewer: reviewerId,
        reviewee,
        role,
        rating: dto.rating,
        comment: dto.comment,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(
          'You have already reviewed this transaction',
        );
      }
      throw err;
    }

    await this.recalculate(reviewee);

    await this.notificationsService.notifyUser(reviewee, {
      title: 'New review received',
      body: `You received a ${dto.rating}-star review.`,
      data: { type: 'review_received', reviewId: review._id.toString() },
    });

    return review.toObject();
  }

  async listForUser(userId: string, dto: ListReviewsDto) {
    if (!isValidObjectId(userId)) {
      throw new NotFoundException('User not found');
    }
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const [found, total] = await Promise.all([
      this.reviewModel
        .find({ reviewee: userId })
        .populate('reviewer', REVIEWER_POPULATE_FIELDS)
        .populate('listing', REVIEW_LISTING_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.reviewModel.countDocuments({ reviewee: userId }),
    ]);

    return {
      results: found.map((r) => this.shapeReview(r)),
      total,
      page,
      limit,
    };
  }

  // Both reviews left on a transaction (buyer's and seller's, whichever
  // exist) — only visible to the two parties on that transaction.
  async listForTransaction(transactionId: string, requesterId: string) {
    await this.transactionsService.findForUser(transactionId, requesterId);
    const found = await this.reviewModel
      .find({ transaction: transactionId })
      .populate('reviewer', REVIEWER_POPULATE_FIELDS)
      .populate('listing', REVIEW_LISTING_POPULATE_FIELDS)
      .exec();
    return found.map((r) => this.shapeReview(r));
  }

  async adminRemove(reviewId: string, adminId: string): Promise<void> {
    if (!isValidObjectId(reviewId)) {
      throw new NotFoundException('Review not found');
    }
    const review = await this.reviewModel.findById(reviewId);
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    const revieweeId = review.reviewee.toString();
    await review.deleteOne();
    await this.recalculate(revieweeId);
    await this.auditLogService.record({
      entityType: 'review',
      entityId: reviewId,
      event: 'review.removed',
      actor: adminId,
      oldState: review.status,
    });
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
        transactionId: r.transaction.toString(),
        listingTitle: listing?.title ?? '',
        reviewerName: reviewer?.name ?? '',
        reviewerEmail: reviewer?.email ?? '',
        role: r.role,
        rating: r.rating,
        comment: r.comment ?? '',
        status: r.status,
        createdAt: r.createdAt,
      };
    });

    return toCsv(rows, [
      'id',
      'transactionId',
      'listingTitle',
      'reviewerName',
      'reviewerEmail',
      'role',
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

  // Lighter-weight than adminRemove() — keeps the review, just marks the
  // flag as handled rather than deleting it outright.
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
  // `review`. role reuses the review's own stored role field (buyer/seller
  // on that transaction) rather than inventing a per-User role — there
  // isn't one.
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
          role: review.role,
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
