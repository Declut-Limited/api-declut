import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.create(user.sub, dto);
  }

  // The caller's own review for this listing (a listing is only ever bought
  // once, so at most one exists) — not a public "everyone's review" lookup.
  @Get('listing/:listingId')
  getForListing(
    @CurrentUser() user: AccessTokenPayload,
    @Param('listingId') listingId: string,
  ) {
    return this.reviewsService.getForListing(listingId, user.sub);
  }

  // The caller's own reviews left for this seller (potentially more than
  // one, across separate purchases) — not a public "everyone's reviews of
  // this seller" feed.
  @Get('user/:userId')
  listForUser(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId') userId: string,
    @Query() dto: ListReviewsDto,
  ) {
    return this.reviewsService.listForUser(userId, user.sub, dto);
  }
}
