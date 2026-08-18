import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  Listing,
  ListingDocument,
  ListingStatus,
} from './schemas/listing.schema';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { SettingsService } from '../settings/settings.service';
import { CategoriesService } from '../categories/categories.service';
import { CounterService } from '../common/counter/counter.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { escapeRegex } from '../common/utils/regex.util';

const CATEGORY_POPULATE_FIELDS = 'title slug';

@Injectable()
export class ListingsService {
  constructor(
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
    private readonly settingsService: SettingsService,
    private readonly categoriesService: CategoriesService,
    private readonly counterService: CounterService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    sellerId: string,
    dto: CreateListingDto,
  ): Promise<ListingDocument> {
    await this.categoriesService.findById(dto.category);
    const slug = await this.counterService.nextSlug('listing', 'LST', 4);
    const listing = await this.listingModel.create({
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
      specs: dto.specs,
      slug,
      priceHistory: [{ price: dto.price, changedAt: new Date() }],
    });
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: listing._id.toString(),
      event: 'listing.created',
      actor: sellerId,
      newState: listing.status,
    });
    return listing;
  }

  async findById(id: string): Promise<ListingDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Listing not found');
    }
    const listing = await this.listingModel
      .findOne({ _id: id, status: { $ne: ListingStatus.DELETED } })
      .populate('category', CATEGORY_POPULATE_FIELDS);
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

    if (dto.category !== undefined) {
      await this.categoriesService.findById(dto.category);
    }

    const changedFields: string[] = [];
    if (dto.title !== undefined) {
      listing.title = dto.title;
      changedFields.push('title');
    }
    if (dto.description !== undefined) {
      listing.description = dto.description;
      changedFields.push('description');
    }
    if (dto.category !== undefined) {
      listing.category = new Types.ObjectId(dto.category);
      changedFields.push('category');
    }
    if (dto.condition !== undefined) {
      listing.condition = dto.condition;
      changedFields.push('condition');
    }
    if (dto.price !== undefined && dto.price !== listing.price) {
      listing.price = dto.price;
      listing.priceHistory.push({ price: dto.price, changedAt: new Date() });
      changedFields.push('price');
    }
    if (dto.images !== undefined) {
      listing.images = dto.images;
      changedFields.push('images');
    }
    if (dto.locationLabel !== undefined) {
      listing.locationLabel = dto.locationLabel;
      changedFields.push('locationLabel');
    }
    if (dto.location !== undefined) {
      listing.location = {
        type: 'Point',
        coordinates: [dto.location.lng, dto.location.lat],
      };
      changedFields.push('location');
    }
    if (dto.specs !== undefined) {
      listing.specs = dto.specs;
      changedFields.push('specs');
    }

    await listing.save();
    if (changedFields.length > 0) {
      await this.auditLogService.record({
        entityType: 'listing',
        entityId: id,
        event: 'listing.updated',
        actor: userId,
        metadata: { fields: changedFields },
      });
    }
    return listing;
  }

  // Fire-and-forget from the public single-listing GET — never blocks or
  // fails the response over a view-count write.
  incrementViews(id: string): void {
    this.listingModel
      .updateOne({ _id: id }, { $inc: { views: 1 } })
      .exec()
      .catch(() => undefined);
  }

  async incrementSaves(id: string): Promise<void> {
    await this.listingModel
      .updateOne({ _id: id }, { $inc: { saves: 1 } })
      .exec();
  }

  async decrementSaves(id: string): Promise<void> {
    await this.listingModel
      .updateOne({ _id: id, saves: { $gt: 0 } }, { $inc: { saves: -1 } })
      .exec();
  }

  async archive(id: string, userId: string): Promise<ListingDocument> {
    const listing = await this.findOwned(id, userId);
    const oldState = listing.status;
    listing.status = ListingStatus.ARCHIVED;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.archived',
      actor: userId,
      oldState,
      newState: listing.status,
    });
    return listing;
  }

  async remove(id: string, userId: string): Promise<void> {
    const listing = await this.findOwned(id, userId);
    // Soft delete — a Transaction may reference this listing later, and we
    // never want a real Mongo delete to break that audit trail.
    const oldState = listing.status;
    listing.status = ListingStatus.DELETED;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.deleted',
      actor: userId,
      oldState,
      newState: listing.status,
    });
  }

  async search(dto: SearchListingsDto): Promise<{
    results: ListingDocument[];
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const filter: Record<string, unknown> = { status: ListingStatus.ACTIVE };
    // A real ObjectId instance, not the raw string — aggregation pipelines
    // (the $geoNear path below) don't auto-cast query filters the way
    // .find() does, so a bare string would silently match nothing.
    if (dto.category) filter.category = new Types.ObjectId(dto.category);
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
    // there too) rather than a separate $match. $lookup replaces .populate()
    // here since aggregation pipelines don't support it.
    if (dto.lat !== undefined && dto.lng !== undefined) {
      const settings = await this.settingsService.get();
      const radiusKm = dto.radiusKm ?? settings.defaultSearchRadiusKm;

      const results = await this.listingModel.aggregate<ListingDocument>([
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
        {
          $lookup: {
            from: 'categories',
            localField: 'category',
            foreignField: '_id',
            as: 'category',
            pipeline: [{ $project: { _id: 1, title: 1, slug: 1 } }],
          },
        },
        { $unwind: '$category' },
      ]);
      return { results, page, limit };
    }

    // No location — plain keyword/filter search, ranked by text relevance
    // when a keyword is given, otherwise newest first.
    const query = this.listingModel
      .find(filter)
      .populate('category', CATEGORY_POPULATE_FIELDS);
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

  // Unlike search()/findById(), admin visibility includes every status —
  // an admin investigating a report or a dispute needs to see the listing
  // regardless of its current lifecycle state.
  async adminList(
    page: number,
    limit: number,
    status?: ListingStatus,
    search?: string,
  ): Promise<{
    results: ListingDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: Record<string, unknown> = status ? { status } : {};
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.title = re;
    }
    const [results, total] = await Promise.all([
      this.listingModel
        .find(filter)
        .populate('category', CATEGORY_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.listingModel.countDocuments(filter),
    ]);
    return { results, total, page, limit };
  }

  // Used by the admin Users federated list/detail view — counts all
  // listings regardless of status (a suspended/archived seller's history
  // still matters for the "total listings" figure), plus how many are
  // currently active, per seller id.
  async countsBySeller(
    sellerIds: string[],
  ): Promise<Map<string, { total: number; active: number }>> {
    const ids = sellerIds.map((id) => new Types.ObjectId(id));
    const rows = await this.listingModel.aggregate<{
      _id: unknown;
      total: number;
      active: number;
    }>([
      { $match: { seller: { $in: ids } } },
      {
        $group: {
          _id: '$seller',
          total: { $sum: 1 },
          active: {
            $sum: {
              $cond: [{ $eq: ['$status', ListingStatus.ACTIVE] }, 1, 0],
            },
          },
        },
      },
    ]);
    return new Map(
      rows.map((r) => [String(r._id), { total: r.total, active: r.active }]),
    );
  }

  // Backs the admin Dashboard "active listings" insight card.
  countActive(): Promise<number> {
    return this.listingModel
      .countDocuments({ status: ListingStatus.ACTIVE })
      .exec();
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

  async adminFindBySlug(slug: string): Promise<{
    listing: ListingDocument;
    recentActivity: Awaited<ReturnType<AuditLogService['findForEntity']>>;
  }> {
    const listing = await this.listingModel
      .findOne({ slug })
      .populate('category', CATEGORY_POPULATE_FIELDS)
      .exec();
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    const recentActivity = await this.auditLogService.findForEntity(
      'listing',
      listing._id.toString(),
      3,
    );
    return { listing, recentActivity };
  }

  // Called by TransactionsService when a transaction reaches 'completed' —
  // an already-sold item no longer shows up in regular search (which only
  // ever returns ACTIVE listings), same as archiving or deleting. No human
  // actor triggers this directly (it's a side effect of payment completion),
  // hence 'system'.
  async markSold(id: string): Promise<void> {
    const listing = await this.listingModel.findById(id).exec();
    if (!listing) return;
    const oldState = listing.status;
    listing.status = ListingStatus.SOLD;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.sold',
      actor: 'system',
      oldState,
      newState: listing.status,
    });
  }

  async flag(id: string, adminId: string): Promise<ListingDocument> {
    const listing = await this.adminFindById(id);
    const oldState = listing.status;
    listing.status = ListingStatus.FLAGGED;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.flagged',
      actor: adminId,
      oldState,
      newState: listing.status,
    });
    return listing;
  }

  // Admin removal — same soft-delete mechanism as a seller's own delete,
  // just without the ownership check.
  async adminRemove(id: string, adminId: string): Promise<void> {
    const listing = await this.adminFindById(id);
    const oldState = listing.status;
    listing.status = ListingStatus.DELETED;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.deleted_by_admin',
      actor: adminId,
      oldState,
      newState: listing.status,
    });
  }

  // Takes an already-resolved seller id — resolving a USR-#### slug to an
  // id is UsersService's job (see AdminService.getListingsByUser).
  async byUser(
    sellerId: string,
    page: number,
    limit: number,
  ): Promise<{
    results: ListingDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = { seller: sellerId, status: { $ne: ListingStatus.DELETED } };
    const [results, total] = await Promise.all([
      this.listingModel
        .find(filter)
        .populate('category', CATEGORY_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.listingModel.countDocuments(filter),
    ]);
    return { results, total, page, limit };
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
