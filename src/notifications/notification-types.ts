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
  listing_flagged: {
    label: 'Listing flagged',
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
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export function channelsFor(
  type: NotificationType,
  recipientType: NotificationRecipientType,
): NotificationChannel[] {
  return NOTIFICATION_TYPES[type].channels[recipientType];
}
