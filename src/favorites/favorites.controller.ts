import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { ListFavoritesDto } from './dto/list-favorites.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenPayload, @Query() dto: ListFavoritesDto) {
    return this.favoritesService.list(user.sub, dto);
  }

  @Post(':listingId')
  add(
    @CurrentUser() user: AccessTokenPayload,
    @Param('listingId') listingId: string,
  ) {
    return this.favoritesService.add(user.sub, listingId);
  }

  @Delete(':listingId')
  remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('listingId') listingId: string,
  ) {
    return this.favoritesService.remove(user.sub, listingId);
  }
}
