import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { ListingsService } from '../listings/listings.service';
import { ListingStatus } from '../listings/schemas/listing.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionStatus } from '../transactions/schemas/transaction.schema';
import { OffersService } from '../offers/offers.service';
import { ReviewsService } from '../reviews/reviews.service';
import { TrustScoreService } from '../trust-score/trust-score.service';
import { KycStatus } from '../users/schemas/user.schema';

/**
 * Thin orchestration layer over services that already exist — every method
 * here delegates to a single call on UsersService/ListingsService/etc.
 * (each of which already enforces its own invariants). Kept as its own
 * service, rather than having AdminController call five different services
 * directly, so the controller stays routes-only per this codebase's layering
 * convention, even though there's no admin-specific business logic beyond
 * "which service method to call."
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
  ) {}

  listUsers(page: number, limit: number) {
    return this.usersService.adminListUsers(page, limit);
  }

  getUser(userId: string) {
    return this.usersService.getPrivateProfile(userId);
  }

  async overrideKycStatus(userId: string, status: KycStatus) {
    await this.usersService.setKycStatus(userId, status);
    if (status === KycStatus.VERIFIED) {
      await this.trustScoreService.recalculate(userId);
    }
    return this.usersService.getPrivateProfile(userId);
  }

  listListings(page: number, limit: number, status?: ListingStatus) {
    return this.listingsService.adminList(page, limit, status);
  }

  getListing(listingId: string) {
    return this.listingsService.adminFindById(listingId);
  }

  listTransactions(page: number, limit: number, status?: TransactionStatus) {
    return this.transactionsService.adminList(page, limit, status);
  }

  getTransaction(transactionId: string) {
    return this.transactionsService.adminFindById(transactionId);
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

  removeReview(reviewId: string) {
    return this.reviewsService.adminRemove(reviewId);
  }
}
