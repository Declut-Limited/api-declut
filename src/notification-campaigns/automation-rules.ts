// Static, read-only description of the automated (non-campaign) push
// notifications this app already sends, sourced from CLAUDE.md's
// Notifications Module section. Explicitly NOT a configurable rules engine
// — admins can view this list, not edit it. Each entry mirrors an existing,
// already-wired NotificationsService.notifyUser() call site.
export interface AutomationRule {
  event: string;
  description: string;
  triggeredBy: string;
}

export const AUTOMATION_RULES: AutomationRule[] = [
  {
    event: 'payment_received',
    description:
      'Buyer completes checkout — escrow funds held, confirmation code generated',
    triggeredBy: 'Transactions (Paystack webhook)',
  },
  {
    event: 'funds_released',
    description: 'Seller enters the correct confirmation code',
    triggeredBy: 'Transactions',
  },
  {
    event: 'transaction_stalled',
    description: 'Escrow inactive past the configured threshold',
    triggeredBy: 'Transactions (hourly sweep)',
  },
  {
    event: 'kyc_status_change',
    description: 'A KYC check (NIN or liveness) passes or fails',
    triggeredBy: 'KYC',
  },
  {
    event: 'offer_received',
    description: 'A buyer submits an offer on a listing',
    triggeredBy: 'Offers',
  },
  {
    event: 'offer_accepted',
    description: 'A seller accepts an offer',
    triggeredBy: 'Offers',
  },
  {
    event: 'offer_countered',
    description: 'A seller counters an offer',
    triggeredBy: 'Offers',
  },
  {
    event: 'offer_rejected',
    description: 'A seller rejects an offer',
    triggeredBy: 'Offers',
  },
  {
    event: 'review_received',
    description: 'A review is left after a completed transaction',
    triggeredBy: 'Reviews',
  },
];
