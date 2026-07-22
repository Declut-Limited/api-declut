import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(user.sub, dto);
  }

  @Get('user/:userId')
  listForUser(@Param('userId') userId: string, @Query() dto: ListReviewsDto) {
    return this.reviewsService.listForUser(userId, dto);
  }

  @Get('transaction/:transactionId')
  listForTransaction(
    @CurrentUser() user: AccessTokenPayload,
    @Param('transactionId') transactionId: string,
  ) {
    return this.reviewsService.listForTransaction(transactionId, user.sub);
  }
}
