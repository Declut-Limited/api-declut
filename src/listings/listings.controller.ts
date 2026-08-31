import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { NearbyListingsDto } from './dto/nearby-listings.dto';
import { NearbyLocationDto } from './dto/nearby-location.dto';
import { RecentListingsDto } from './dto/recent-listings.dto';
import { FilterListingsDto } from './dto/filter-listings.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('listings')
@UseGuards(JwtAuthGuard)
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Get('upload-signature')
  getUploadSignature() {
    return this.cloudinaryService.generateUploadSignature();
  }

  // Search and filter — categoryId/useMyLocation/itemCondition/priceRange/search/etc, see FilterListingsDto. Replaces the old flat-param search().
  @Get()
  search(@Query() dto: FilterListingsDto) {
    return this.listingsService.filterListings(dto);
  }

  // Count of active listings within radiusKm (default 5) of (lat, lng) — not a mirror of every /listings filter.
  @Get('count')
  count(@Query() dto: NearbyLocationDto) {
    return this.listingsService.countNearby(
      dto.lat,
      dto.lng,
      dto.radiusKm ?? 5,
    );
  }

  // Must come before ':id' — otherwise Nest would match "nearby"/"new" as the id.
  @Get('nearby')
  nearby(@Query() dto: NearbyListingsDto) {
    return this.listingsService.nearby(dto);
  }

  @Get('new')
  recent(@Query() dto: RecentListingsDto) {
    return this.listingsService.recent(dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const listing = await this.listingsService.findByIdForDisplay(id);
    this.listingsService.incrementViews(id);
    return listing;
  }

  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateListingDto,
  ) {
    return this.listingsService.create(user.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingsService.update(id, user.sub, dto);
  }

  @Patch(':id/archive')
  archive(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.listingsService.archive(id, user.sub);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.listingsService.remove(id, user.sub);
    return { deleted: true };
  }
}
