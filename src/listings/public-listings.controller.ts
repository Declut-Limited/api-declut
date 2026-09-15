import { Controller, Get, Param } from '@nestjs/common';
import { ListingsService } from './listings.service';

// No guard — public, unauthenticated, by slug only. Backs a Next.js
// server-side metadata/OG-tag fetch for a listing's share link, same "fully
// unauthenticated" posture as PublicCategoriesController/WaitlistController.
// Lives under /listings/public/:slug (not bare /listings/:slug) so it can't
// collide with the authenticated ListingsController's own /listings/:idOrSlug
// route — different segment count, so Nest can't confuse the two regardless
// of registration order. Added 2026-09-15, explicit instruction.
@Controller('listings/public')
export class PublicListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.listingsService.findPublicBySlug(slug);
  }
}
