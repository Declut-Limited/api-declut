// Every entityType.verb / snake_case event string AuditLogService.record() is called with, mapped to a readable label. Unknown future events fall back to humanize().
const EVENT_LABELS: Record<string, string> = {
  'listing.created': 'Listing created',
  'listing.updated': 'Listing updated',
  'listing.deleted': 'Listing deleted',
  'listing.sold': 'Listing marked as sold',
  'listing.reported': 'Listing reported',
  'listing.delisted': 'Listing delisted',
  'listing.relisted': 'Listing relisted',
  'listing.deleted_by_admin': 'Listing removed by admin',
  'content.created': 'Content created',
  'content.updated': 'Content updated',
  'content.deleted': 'Content deleted',
  'campaign.created': 'Notification campaign created',
  'campaign.updated': 'Notification campaign updated',
  'campaign.deleted': 'Notification campaign deleted',
  'campaign.sent': 'Notification campaign sent',
  'report.created': 'Report created',
  'report.status_updated': 'Report status updated',
  'review.removed': 'Review removed',
  'review.flagged': 'Review flagged',
  'review.resolved': 'Review flag resolved',
  checkout_initiated: 'Checkout initiated',
  payment_amount_mismatch: 'Payment amount mismatch detected',
  listing_unavailable_after_payment: 'Listing became unavailable after payment',
  escrow_held: 'Funds held in escrow',
  funds_released: 'Funds released to seller',
  buyer_cancelled_with_refund: 'Cancelled by buyer with refund',
  cancelled_by_buyer: 'Cancelled by buyer',
  admin_released: 'Funds released by admin',
  admin_refunded: 'Refunded by admin',
  auto_cancelled_abandoned_checkout:
    'Automatically cancelled — checkout abandoned',
  inspection_extension_requested: 'Requested inspection extension',
  inspection_extended: 'Inspection window extended',
  inspection_expired_auto_refunded:
    'Automatically refunded — inspection window expired',
  admin_sent_inspection_reminder: 'Inspection reminder sent by admin',
  transaction_note_added: 'Admin note added',
  transaction_note_updated: 'Admin note updated',
  transaction_note_removed: 'Admin note removed',
  // code_mismatch_max_attempts: 'Marked as disputed after repeated wrong codes',
  // code_mismatch: 'Wrong confirmation code entered',
};

export function describeEvent(event: string): string {
  return EVENT_LABELS[event] ?? humanize(event);
}

function humanize(event: string): string {
  const words = event.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
