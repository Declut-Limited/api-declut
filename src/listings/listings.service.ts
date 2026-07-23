import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  Listing,
  ListingDocument,
  ListingStatus,
} from './schemas/listing.schema';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';

@Injectable()
export class ListingsService {
  constructor(
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
    private readonly config: ConfigService,
  ) {}

  create(sellerId: string, dto: CreateListingDto): Promise<ListingDocument> {
    return this.listingModel.create({
      seller: sellerId,
      title: dto.title,
      description: dto.description,
      category: dto.category,
      condition: dto.condition,
      price: dto.price,
      images: dto.images,
      location: {
        type: 'Point',
        coordinates: [dto.location.lng, dto.location.lat],
      },
      locationLabel: dto.locationLabel,
    });
  }

  async findById(id: string): Promise<ListingDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Listing not found');
    }
    const listing = await this.listingModel.findOne({
      _id: id,
      status: { $ne: ListingStatus.DELETED },
    });
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateListingDto,
  ): Promise<ListingDocument> {
    const listing = await this.findOwned(id, userId);

    if (dto.title !== undefined) listing.title = dto.title;
    if (dto.description !== undefined) listing.description = dto.description;
    if (dto.category !== undefined) listing.category = dto.category;
    if (dto.condition !== undefined) listing.condition = dto.condition;
    if (dto.price !== undefined) listing.price = dto.price;
    if (dto.images !== undefined) listing.images = dto.images;
    if (dto.locationLabel !== undefined)
      listing.locationLabel = dto.locationLabel;
    if (dto.location !== undefined) {
      listing.location = {
        type: 'Point',
        coordinates: [dto.location.lng, dto.location.lat],
      };
    }

    await listing.save();
    return listing;
  }

  async archive(id: string, userId: string): Promise<ListingDocument> {
    const listing = await this.findOwned(id, userId);
    listing.status = ListingStatus.ARCHIVED;
    await listing.save();
    return listing;
  }

  async remove(id: string, userId: string): Promise<void> {
    const listing = await this.findOwned(id, userId);
    // Soft delete — a Transaction may reference this listing later, and we
    // never want a real Mongo delete to break that audit trail.
    listing.status = ListingStatus.DELETED;
    await listing.save();
  }

  async search(dto: SearchListingsDto): Promise<{
    results: ListingDocument[];
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const filter: Record<string, unknown> = { status: ListingStatus.ACTIVE };
    if (dto.category) filter.category = dto.category;
    if (dto.condition) filter.condition = dto.condition;
    if (dto.minPrice !== undefined || dto.maxPrice !== undefined) {
      filter.price = {
        ...(dto.minPrice !== undefined && { $gte: dto.minPrice }),
        ...(dto.maxPrice !== undefined && { $lte: dto.maxPrice }),
      };
    }
    if (dto.keyword) {
      filter.$text = { $search: dto.keyword };
    }

    // Radius search: $geoNear must be the pipeline's first stage, and folds
    // our other filters into its own `query` option (Mongo supports $text
    // there too) rather than a separate $match.
    if (dto.lat !== undefined && dto.lng !== undefined) {
      const radiusKm =
        dto.radiusKm ?? this.config.get<number>('DEFAULT_SEARCH_RADIUS_KM', 15);

      const results = await this.listingModel.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [dto.lng, dto.lat] },
            distanceField: 'distanceMeters',
            maxDistance: radiusKm * 1000,
            spherical: true,
            query: filter,
          },
        },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]);
      return { results, page, limit };
    }

    // No location — plain keyword/filter search, ranked by text relevance
    // when a keyword is given, otherwise newest first.
    const query = this.listingModel.find(filter);
    if (dto.keyword) {
      query.sort({ score: { $meta: 'textScore' } });
    } else {
      query.sort({ createdAt: -1 });
    }
    const results = await query
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    return { results, page, limit };
  }

  // Unlike search()/findById(), admin visibility includes ARCHIVED and
  // DELETED listings — an admin investigating a report or a dispute needs
  // to see the listing regardless of its current lifecycle state.
  async adminList(
    page: number,
    limit: number,
    status?: ListingStatus,
  ): Promise<{
    results: ListingDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = status ? { status } : {};
    const [results, total] = await Promise.all([
      this.listingModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.listingModel.countDocuments(filter),
    ]);
    return { results, total, page, limit };
  }

  async adminFindById(id: string): Promise<ListingDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Listing not found');
    }
    const listing = await this.listingModel.findById(id);
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<ListingDocument> {
    const listing = await this.findById(id);
    if (listing.seller.toString() !== userId) {
      throw new ForbiddenException('You do not own this listing');
    }
    return listing;
  }
}
