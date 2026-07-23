import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Favorite, FavoriteDocument } from './schemas/favorite.schema';
import { ListingsService } from '../listings/listings.service';
import { ListingStatus } from '../listings/schemas/listing.schema';
import { ListFavoritesDto } from './dto/list-favorites.dto';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(Favorite.name) private favoriteModel: Model<FavoriteDocument>,
    private readonly listingsService: ListingsService,
  ) {}

  async add(userId: string, listingId: string): Promise<{ favorited: true }> {
    // Throws NotFoundException if the listing doesn't exist or is deleted —
    // no favoriting a listing that isn't there.
    await this.listingsService.findById(listingId);

    // Idempotent: favoriting an already-favorited listing is a no-op, not
    // an error — upsert on the unique (user, listing) index handles races
    // (e.g. a double-tap) without a duplicate-key error reaching the client.
    await this.favoriteModel.updateOne(
      { user: userId, listing: listingId },
      { $setOnInsert: { user: userId, listing: listingId } },
      { upsert: true },
    );

    return { favorited: true };
  }

  async remove(
    userId: string,
    listingId: string,
  ): Promise<{ favorited: false }> {
    if (!isValidObjectId(listingId)) {
      throw new NotFoundException('Listing not found');
    }
    await this.favoriteModel.deleteOne({ user: userId, listing: listingId });
    return { favorited: false };
  }

  async list(userId: string, dto: ListFavoritesDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const favorites = await this.favoriteModel
      .find({ user: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: 'listing',
        match: { status: { $ne: ListingStatus.DELETED } },
      })
      .exec();

    // A favorited listing may since have been soft-deleted — populate's
    // match option resolves those to null, filtered out here rather than
    // showing a dangling reference.
    return {
      results: favorites
        .filter((f) => f.listing !== null)
        .map((f) => f.listing),
      page,
      limit,
    };
  }
}
