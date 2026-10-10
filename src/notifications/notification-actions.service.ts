import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
} from '../transactions/schemas/transaction.schema';
import { Report, ReportDocument } from '../reports/schemas/report.schema';

// Which app screen a notification's link opens (2026-10-10, explicit instruction — "the API
// decides"). The app maps each screen to its own route; params are exactly what that route takes:
//   purchase      buyer's purchase view      { listingId, transactionId }
//   transaction   seller's transaction view  { transactionId }
//   report        seller's report view       { listingId }
//   delist        seller's delist reason     { listingId }
//   campaign      referral campaign detail   { idOrCode }
//   participation my campaign participation  { idOrCode }
//   myListing     seller's own listing view  { listingId } (2026-10-10 — where they confirm arrival)
export type NotificationActionScreen =
  | 'purchase'
  | 'transaction'
  | 'report'
  | 'delist'
  | 'campaign'
  | 'participation'
  | 'myListing';

export interface NotificationAction {
  screen: NotificationActionScreen;
  label: string;
  params: Record<string, string>;
}

interface TransactionLookup {
  _id: Types.ObjectId;
  buyer: Types.ObjectId;
  seller: Types.ObjectId;
  listing: Types.ObjectId;
}

interface ReportLookup {
  _id: Types.ObjectId;
  listing?: Types.ObjectId;
  transaction?: Types.ObjectId;
}

interface NotificationLike {
  type: string;
  data?: Record<string, string> | null;
}

// Link text per transaction notification type, by the recipient's side of the deal. Any other
// type that carries a transactionId falls back to DEFAULT_TRANSACTION_LABEL.
const TRANSACTION_LABELS: Record<string, { buyer: string; seller: string }> = {
  payment_received: {
    buyer: 'View escrow details',
    seller: 'Open transaction',
  },
  inspection_extended: {
    buyer: 'Extend or inspect',
    seller: 'Open transaction',
  },
  inspection_reminder: {
    buyer: 'Extend or inspect',
    seller: 'Open transaction',
  },
  purchase_reported: { buyer: 'View report', seller: 'Respond to report' },
  inspection_started: { buyer: 'Open transaction', seller: 'Confirm arrival' },
  arrival_reminder: { buyer: 'Open transaction', seller: 'Confirm arrival' },
  arrival_confirmed: { buyer: 'Inspect item', seller: 'Open transaction' },
  arrival_report_unlocked: {
    buyer: 'Report a problem',
    seller: 'Open transaction',
  },
  dispute_raised: { buyer: 'Open dispute', seller: 'Open dispute' },
  funds_released: { buyer: 'View details', seller: 'View details' },
  admin_released: { buyer: 'View details', seller: 'View details' },
  admin_refunded: { buyer: 'View details', seller: 'View details' },
  seller_refunded_report: { buyer: 'View details', seller: 'View details' },
  purchase_cancelled_refunded: {
    buyer: 'View details',
    seller: 'View details',
  },
  listing_unavailable_after_payment: {
    buyer: 'View details',
    seller: 'View details',
  },
  inspection_expired_refunded: {
    buyer: 'View details',
    seller: 'View details',
  },
};
const DEFAULT_TRANSACTION_LABEL = 'Open transaction';

// Worked out when read (GET /notifications, the realtime echo, the push payload) rather than
// stored, so notifications saved before this existed get links too. Batched: one query per
// collection per page, whatever the page size. Notifications with nothing to open (content
// updates, KYC, flagged reviews, or ones missing the id) get null.
@Injectable()
export class NotificationActionsService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(Report.name)
    private readonly reportModel: Model<ReportDocument>,
  ) {}

  async resolveOne(
    recipientId: string,
    notification: NotificationLike,
  ): Promise<NotificationAction | null> {
    const [action] = await this.resolve(recipientId, [notification]);
    return action;
  }

  async resolve(
    recipientId: string,
    notifications: NotificationLike[],
  ): Promise<(NotificationAction | null)[]> {
    const transactionIds = new Set<string>();
    const reportIds = new Set<string>();
    for (const n of notifications) {
      const transactionId = n.data?.transactionId;
      const reportId = n.data?.reportId;
      if (transactionId && Types.ObjectId.isValid(transactionId)) {
        transactionIds.add(transactionId);
      }
      if (reportId && Types.ObjectId.isValid(reportId)) reportIds.add(reportId);
    }

    const [transactions, reports] = await Promise.all([
      transactionIds.size
        ? this.transactionModel
            .find({ _id: { $in: [...transactionIds] } }, 'buyer seller listing')
            .lean<TransactionLookup[]>()
            .exec()
        : Promise.resolve([] as TransactionLookup[]),
      reportIds.size
        ? this.reportModel
            .find({ _id: { $in: [...reportIds] } }, 'listing transaction')
            .lean<ReportLookup[]>()
            .exec()
        : Promise.resolve([] as ReportLookup[]),
    ]);
    const transactionById = new Map(
      transactions.map((t) => [t._id.toString(), t]),
    );
    const reportById = new Map(reports.map((r) => [r._id.toString(), r]));

    return notifications.map((n): NotificationAction | null => {
      const data = n.data ?? {};

      if (data.transactionId) {
        const tx = transactionById.get(data.transactionId);
        if (!tx) return null;
        const listingId = tx.listing.toString();
        if (tx.buyer.toString() === recipientId) {
          return {
            screen: 'purchase',
            label:
              TRANSACTION_LABELS[n.type]?.buyer ?? DEFAULT_TRANSACTION_LABEL,
            params: { listingId, transactionId: data.transactionId },
          };
        }
        if (tx.seller.toString() === recipientId) {
          const label =
            TRANSACTION_LABELS[n.type]?.seller ?? DEFAULT_TRANSACTION_LABEL;
          // A buyer's report is answered from the seller's report screen, and a buyer's arrival
          // is confirmed from the seller's own listing page — not the transaction view.
          if (n.type === 'purchase_reported') {
            return { screen: 'report', label, params: { listingId } };
          }
          if (
            n.type === 'inspection_started' ||
            n.type === 'arrival_reminder'
          ) {
            return { screen: 'myListing', label, params: { listingId } };
          }
          return {
            screen: 'transaction',
            label,
            params: { transactionId: data.transactionId },
          };
        }
        return null;
      }

      switch (n.type) {
        case 'listing_reported':
          return data.listingId
            ? {
                screen: 'report',
                label: 'View report',
                params: { listingId: data.listingId },
              }
            : null;
        case 'listing_unlisted':
          return data.listingId
            ? {
                screen: 'delist',
                label: 'View delist reason',
                params: { listingId: data.listingId },
              }
            : null;
        case 'seller_response_sla_reminder': {
          const report = data.reportId ? reportById.get(data.reportId) : null;
          return report?.listing
            ? {
                screen: 'report',
                label: 'Respond to report',
                params: { listingId: report.listing.toString() },
              }
            : null;
        }
        case 'report_resolved': {
          // The reporter is the buyer — their purchase view shows the report's outcome.
          const report = data.reportId ? reportById.get(data.reportId) : null;
          return report?.listing && report.transaction
            ? {
                screen: 'purchase',
                label: 'View details',
                params: {
                  listingId: report.listing.toString(),
                  transactionId: report.transaction.toString(),
                },
              }
            : null;
        }
        case 'referral_campaign_joined':
          return data.campaignId
            ? {
                screen: 'participation',
                label: 'View campaign',
                params: { idOrCode: data.campaignId },
              }
            : null;
        case 'referral_campaign_left':
          return data.campaignId
            ? {
                screen: 'campaign',
                label: 'View campaign',
                params: { idOrCode: data.campaignId },
              }
            : null;
        default:
          return null;
      }
    });
  }

  // Push data must be flat strings — the app reads these back on a notification tap.
  toPushData(action: NotificationAction | null): Record<string, string> {
    if (!action) return {};
    return {
      actionScreen: action.screen,
      actionLabel: action.label,
      actionParams: JSON.stringify(action.params),
    };
  }
}
