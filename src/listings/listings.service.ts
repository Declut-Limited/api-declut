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
const SELLER_POPULATE_FIELDS =
  'name phone accountStatus company avgRating createdAt slug';

interface PopulatedSeller {
  _id: Types.ObjectId;
  name: string;
  phone?: string;
  accountStatus: string;
  company?: string;
  avgRating: number;
  createdAt: Date;
  slug?: string;
}

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

  // Display-only variant of findById() — seller populated and reshaped for
  // the public single-listing GET. Deliberately separate from findById()
  // itself: OffersService/TransactionsService/FavoritesService all call
  // findById() internally and read listing.seller as a raw ObjectId
  // (ownership checks, seller lookups) — populating seller there would
  // silently corrupt every one of those .toString() comparisons.
  async findByIdForDisplay(id: string): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Listing not found');
    }
    const listing = await this.listingModel
      .findOne({ _id: id, status: { $ne: ListingStatus.DELETED } })
      .populate('category', CATEGORY_POPULATE_FIELDS)
      .populate('seller', SELLER_POPULATE_FIELDS);
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    const [shaped] = await this.attachSellerSummaries([listing]);
    return shaped;
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
    results: Record<string, unknown>[];
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

      const rows = await this.listingModel.aggregate<
        ListingDocument & { seller: PopulatedSeller }
      >([
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
        {
          $lookup: {
            from: 'users',
            localField: 'seller',
            foreignField: '_id',
            as: 'seller',
            pipeline: [
              {
                $project: {
                  name: 1,
                  phone: 1,
                  accountStatus: 1,
                  company: 1,
                  avgRating: 1,
                  createdAt: 1,
                },
              },
            ],
          },
        },
        { $unwind: '$seller' },
      ]);

      const counts = await this.countsBySeller([
        ...new Set(rows.map((r) => r.seller._id.toString())),
      ]);
      const results = rows.map((r) => ({
        ...r,
        seller: this.shapeSellerSummary(
          r.seller,
          counts.get(r.seller._id.toString())?.total ?? 0,
        ),
      }));
      return { results, page, limit };
    }

    // No location — plain keyword/filter search, ranked by text relevance
    // when a keyword is given, otherwise newest first.
    const query = this.listingModel
      .find(filter)
      .populate('category', CATEGORY_POPULATE_FIELDS)
      .populate('seller', SELLER_POPULATE_FIELDS);
    if (dto.keyword) {
      query.sort({ score: { $meta: 'textScore' } });
    } else {
      query.sort({ createdAt: -1 });
    }
    const found = await query
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();
    const results = await this.attachSellerSummaries(found);

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
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: Record<string, unknown> = status ? { status } : {};
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.title = re;
    }
    const [found, total] = await Promise.all([
      this.listingModel
        .find(filter)
        .populate('category', CATEGORY_POPULATE_FIELDS)
        .populate('seller', SELLER_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.listingModel.countDocuments(filter),
    ]);
    const results = await this.attachSellerSummaries(found);
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

  // Backs the admin Dashboard "active listings" card — live, unscoped snapshot.
  countActive(): Promise<number> {
    return this.listingModel
      .countDocuments({ status: ListingStatus.ACTIVE })
      .exec();
  }

  // Trend context for activeListings: new-listing rate, since the live total has no period of its own (judgment call).
  countCreatedInRange(since?: Date, until?: Date): Promise<number> {
    const filter = since
      ? { createdAt: until ? { $gte: since, $lt: until } : { $gte: since } }
      : {};
    return this.listingModel.countDocuments(filter).exec();
  }

  // Used internally as a mutation target (flag/adminRemove) and by
  // AdminService.emailSeller() for the raw seller id — deliberately
  // unpopulated. See adminFindByIdWithCategory() for the display variant.
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

  // Display variant for TransactionsService's admin transaction-detail view
  // (its `listing` sub-object populates category → { name, slug }).
  async adminFindByIdWithCategory(id: string): Promise<ListingDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Listing not found');
    }
    const listing = await this.listingModel
      .findById(id)
      .populate('category', CATEGORY_POPULATE_FIELDS)
      .exec();
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
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = { seller: sellerId, status: { $ne: ListingStatus.DELETED } };
    const [found, total] = await Promise.all([
      this.listingModel
        .find(filter)
        .populate('category', CATEGORY_POPULATE_FIELDS)
        .populate('seller', SELLER_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.listingModel.countDocuments(filter),
    ]);
    const results = await this.attachSellerSummaries(found, true);
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

  // Shared by every display-facing query method above — turns a populated
  // seller sub-document into the agreed response shape. listingsCount comes
  // from countsBySeller() (already built for the admin Users insights view)
  // rather than being recomputed here.
  private shapeSellerSummary(
    seller: PopulatedSeller | null,
    listingsCount: number,
    includeSlug = false,
  ): Record<string, unknown> | null {
    if (!seller) return null;
    return {
      id: seller._id.toString(),
      ...(includeSlug && { slug: seller.slug }),
      name: seller.name,
      contact: seller.phone,
      role: 'Seller',
      status: seller.accountStatus,
      company: seller.company,
      listingsCount,
      createdAt: seller.createdAt,
      rating: seller.avgRating.toFixed(1),
    };
  }

  private async attachSellerSummaries(
    listings: ListingDocument[],
    includeSlug = false,
  ): Promise<Record<string, unknown>[]> {
    const sellerIds = [
      ...new Set(
        listings
          .map((l) =>
            (l.seller as unknown as PopulatedSeller | null)?._id.toString(),
          )
          .filter((id): id is string => !!id),
      ),
    ];
    const counts = await this.countsBySeller(sellerIds);
    return listings.map((l) => {
      const obj = l.toObject() as unknown as Record<string, unknown>;
      const seller = l.seller as unknown as PopulatedSeller | null;
      obj.seller = this.shapeSellerSummary(
        seller,
        seller ? (counts.get(seller._id.toString())?.total ?? 0) : 0,
        includeSlug,
      );
      return obj;
    });
  }
}
