import { Injectable } from '@nestjs/common';
import { UserEventsGateway } from './user-events.gateway';

// Everything that needs a live connection to a regular user's device lives here — no DB row, no push, no email, just a socket ping so an already-open screen updates itself. Admin's own realtime bell stays separate, in NotificationsGateway/NotificationsService.
@Injectable()
export class AppRealtimeService {
  constructor(private readonly userEventsGateway: UserEventsGateway) {}

  // Mirrors a just-saved Notification onto the recipient's personal socket room — called from NotificationsService.notify() so a User sees it the instant it's created, not just on their next inbox refresh.
  echoNotification(userId: string, payload: Record<string, unknown>): void {
    this.userEventsGateway.emitToUser(userId, 'notification', payload);
  }

  // Listing status ping — broadcastPublic:false keeps a transition off the shared listing room and the global broadcast below (the PAUSED-privacy case: nobody but the owner should ever learn a listing's state changed while it's a private draft).
  emitListingStatusChange(
    listingId: string,
    sellerId: string,
    payload: { status: string; oldStatus?: string },
    broadcastPublic = true,
  ): void {
    const body = { listingId, action: 'status_changed', ...payload };
    if (broadcastPublic) {
      this.userEventsGateway.emitToListing(listingId, 'listing:update', body);
      // Feed screens (nearby/recent/search) have no per-card room subscription — this is their only signal that a listing they may be showing just changed, so they know to refetch.
      this.userEventsGateway.broadcastAll('listings:updated', body);
    }
    this.userEventsGateway.emitToUser(sellerId, 'listing:update', body);
  }

  // Same live-only signal for a plain edit or a hard delete — no status change involved, just "this listing's data is now stale, refetch or drop it."
  emitListingChanged(
    listingId: string,
    sellerId: string,
    action: 'updated' | 'deleted',
  ): void {
    const body = { listingId, action };
    this.userEventsGateway.emitToListing(listingId, 'listing:update', body);
    this.userEventsGateway.emitToUser(sellerId, 'listing:update', body);
  }

  // The "new listing" doorbell — every connected user gets this except the seller who just created it; browse/nearby/recent feeds use it to show a "new listings available" affordance rather than silently reshuffling.
  broadcastNewListing(
    sellerId: string,
    payload: {
      listingId: string;
      title: string;
      price: number;
      mainImageUrl?: string;
    },
  ): void {
    this.userEventsGateway.broadcastAll('listings:new', payload, sellerId);
  }
}
