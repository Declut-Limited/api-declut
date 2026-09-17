import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Dispute, DisputeDocument } from './schemas/dispute.schema';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { ReportsService } from '../reports/reports.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class DisputesService {
  constructor(
    @InjectModel(Dispute.name) private disputeModel: Model<DisputeDocument>,
    private readonly transactionsService: TransactionsService,
    private readonly reportsService: ReportsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Seller-only — the other response to a buyer's report on a purchase in
  // progress, alongside TransactionsService.sellerRefundReportedPurchase().
  // Ownership + status guard (seller-owned, transaction currently REPORTED)
  // lives in TransactionsService.getForSellerDispute() so it's enforced
  // identically to every other object-level check in that service.
  async create(sellerId: string, dto: CreateDisputeDto) {
    const transaction = await this.transactionsService.getForSellerDispute(
      dto.transactionId,
      sellerId,
    );

    // reportId is client-supplied now — still cross-checked against the
    // transaction rather than trusted outright, same "never trust the
    // client on which record ties to which" posture as everywhere else in
    // this app. The Dispute itself doesn't store `listing` — the Report it
    // points at already has one.
    const report = await this.reportsService.getRawById(dto.reportId);
    if (
      !report.listing ||
      report.listing.toString() !== transaction.listing.toString() ||
      report.reporter.toString() !== transaction.buyer.toString()
    ) {
      throw new BadRequestException('This report is not for this purchase');
    }
    if (report.sellerDispute) {
      throw new BadRequestException(
        'A dispute has already been raised for this report',
      );
    }

    const dispute = await this.disputeModel.create({
      seller: sellerId,
      transaction: transaction._id,
      report: report._id,
      disputeClaim: dto.disputeClaim,
      evidenceImages: dto.evidenceImages,
      evidenceVideo: dto.evidenceVideo,
    });

    await this.reportsService.attachDispute(
      report._id.toString(),
      dispute._id.toString(),
    );
    // Transaction.status -> DISPUTED, escrow stays FROZEN — same status the
    // pre-existing payment-race auto-dispute already uses, so
    // adminRelease()/adminRefund() resolve this the same way as any other
    // disputed transaction.
    await this.transactionsService.markDisputedFromSellerDispute(
      transaction._id.toString(),
      sellerId,
    );

    await this.auditLogService.record({
      entityType: 'dispute',
      entityId: dispute._id.toString(),
      event: 'dispute.created',
      actor: sellerId,
      newState: 'created',
    });

    return dispute.toObject();
  }
}
