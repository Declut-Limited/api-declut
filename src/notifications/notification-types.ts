import { NotificationRecipientType } from './schemas/notification.schema';

export type NotificationChannel = 'push' | 'email';

// Which channel(s) each event type uses per recipient type — Admins never get push (no FCM registration exists for Admin), so it's just left out of their arrays.
export const NOTIFICATION_TYPES = {
  content_updated: {
    label: 'Content update',
    channels: {
      [NotificationRecipientType.USER]: [
        'push',
        'email',
      ] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: ['email'] as NotificationChannel[],
    },
  },
  report_resolved: {
    label: 'Report resolved',
    channels: {
      [NotificationRecipientType.USER]: ['push'] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  review_flagged: {
    label: 'Review flagged',
    channels: {
      [NotificationRecipientType.USER]: ['push'] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  // Renamed from listing_flagged 2026-09-12 — "flagged" is no longer a
  // concept in this app, see ListingStatus.REPORTED on the schema.
  listing_reported: {
    label: 'Listing reported',
    channels: {
      [NotificationRecipientType.USER]: ['push'] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  listing_unlisted: {
    label: 'Listing unlisted',
    channels: {
      [NotificationRecipientType.USER]: ['push'] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  role_updated: {
    label: 'Role updated',
    channels: {
      [NotificationRecipientType.USER]: [] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: ['email'] as NotificationChannel[],
    },
  },
  payment_received: {
    label: 'Payment received',
    channels: {
      [NotificationRecipientType.USER]: [
        'push',
        'email',
      ] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  funds_released: {
    label: 'Funds released',
    channels: {
      [NotificationRecipientType.USER]: [
        'push',
        'email',
      ] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  inspection_expired_refunded: {
    label: 'Inspection window expired — auto-refunded',
    channels: {
      [NotificationRecipientType.USER]: [
        'push',
        'email',
      ] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  listing_unavailable_after_payment: {
    label: 'Listing unavailable after payment',
    channels: {
      [NotificationRecipientType.USER]: [
        'push',
        'email',
      ] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  admin_released: {
    label: 'Transaction released by admin',
    channels: {
      [NotificationRecipientType.USER]: [
        'push',
        'email',
      ] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  admin_refunded: {
    label: 'Transaction refunded by admin',
    channels: {
      [NotificationRecipientType.USER]: [
        'push',
        'email',
      ] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  purchase_cancelled_refunded: {
    label: 'Purchase cancelled by buyer',
    channels: {
      [NotificationRecipientType.USER]: [
        'push',
        'email',
      ] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
  inspection_extended: {
    label: 'Inspection window extended',
    channels: {
      [NotificationRecipientType.USER]: [
        'push',
        'email',
      ] as NotificationChannel[],
      [NotificationRecipientType.ADMIN]: [] as NotificationChannel[],
    },
  },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export function channelsFor(
  type: NotificationType,
  recipientType: NotificationRecipientType,
): NotificationChannel[] {
  return NOTIFICATION_TYPES[type].channels[recipientType];
}

// Maps a transaction-lifecycle NotificationType to the NotificationSetting
// category that gates it for User recipients — see notifications.service.ts's
// notify(), which further narrows channelsFor()'s static max down to what the
// recipient's own settings actually allow. Types not listed here (content,
// reports, reviews, listings, roles) are unaffected — existing behavior for
// those is left exactly as it was before this map existed.
export const NOTIFICATION_SETTING_CATEGORY: Partial<
  Record<
    NotificationType,
    | 'transactionUpdates'
    | 'inspectionReminders'
    | 'disputeUpdates'
    | 'paymentAndEscrowUpdates'
  >
> = {
  payment_received: 'paymentAndEscrowUpdates',
  funds_released: 'paymentAndEscrowUpdates',
  inspection_expired_refunded: 'paymentAndEscrowUpdates',
  listing_unavailable_after_payment: 'disputeUpdates',
  admin_released: 'disputeUpdates',
  admin_refunded: 'disputeUpdates',
  // Unlike admin_refunded, this fires on a perfectly normal (not
  // stalled/disputed) transaction — the buyer just changed their mind — so
  // it's a payment-lifecycle event, not a dispute one.
  purchase_cancelled_refunded: 'paymentAndEscrowUpdates',
  inspection_extended: 'inspectionReminders',
};
