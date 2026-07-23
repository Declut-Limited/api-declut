import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Review, ReviewDocument, ReviewerRole } from './schemas/review.schema';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionStatus } from '../transactions/schemas/transaction.schema';
import { UsersService } from '../users/users.service';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private reviewModel: Model<ReviewDocument>,
    private readonly transactionsService: TransactionsService,
    private readonly usersService: UsersService,
    private readonly trustScoreService: TrustScoreService,
    private readonly notificationsService: NotificationsService,
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

    const [results, total] = await Promise.all([
      this.reviewModel
        .find({ reviewee: userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.reviewModel.countDocuments({ reviewee: userId }),
    ]);

    return { results, total, page, limit };
  }

  // Both reviews left on a transaction (buyer's and seller's, whichever
  // exist) — only visible to the two parties on that transaction.
  async listForTransaction(transactionId: string, requesterId: string) {
    await this.transactionsService.findForUser(transactionId, requesterId);
    return this.reviewModel.find({ transaction: transactionId }).exec();
  }

  // Not wired to a controller route yet — exported for the Admin module
  // (moderation) to call once it's built, same deferral pattern as
  // UsersService.setKycStatus.
  async adminRemove(reviewId: string): Promise<void> {
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
}
