import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  Listing,
  ListingCondition,
  ListingDocument,
  ListingStatus,
  MediaAsset,
} from './schemas/listing.schema';
import {
  ListingView,
  ListingViewDocument,
} from './schemas/listing-view.schema';
import {
  Transaction,
  TransactionDocument,
  TransactionStatus,
} from '../transactions/schemas/transaction.schema';
import { CreateListingDto, MediaAssetDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { NearbyListingsDto } from './dto/nearby-listings.dto';
import { RecentListingsDto } from './dto/recent-listings.dto';
import { MyListingStatusFilter } from './dto/my-listings.dto';
import {
  FilterListingsDto,
  ListingExtraFiltersDto,
  ListingFilterDto,
} from './dto/filter-listings.dto';
import { CategoriesService } from '../categories/categories.service';
import { CounterService } from '../common/counter/counter.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppRealtimeService } from '../notifications/app-realtime.service';
import { NotificationRecipientType } from '../notifications/schemas/notification.schema';
import { escapeRegex } from '../common/utils/regex.util';
import { MONTH_ABBREVIATIONS } from '../common/utils/date.util';
import { toCsv } from '../common/utils/csv.util';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { DateRangeDto } from '../common/dto/date-range.dto';

const CATEGORY_POPULATE_FIELDS = 'title slug';
const SELLER_POPULATE_FIELDS =
  '_id name phone accountStatus company avgRating createdAt slug hasPayoutDetails profileImage';
const RECENT_LISTINGS_DAYS = 14;

interface PopulatedSeller {
  _id: Types.ObjectId;
  name: string;
  phone?: string;
  accountStatus: string;
  hasPayoutDetails?: boolean;
  company?: string;
  avgRating: number;
  createdAt: Date;
  slug?: string;
  profileImage?: string;
}

@Injectable()
export class ListingsService {
  constructor(
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
    @InjectModel(ListingView.name)
    private listingViewModel: Model<ListingViewDocument>,
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    private readonly categoriesService: CategoriesService,
    private readonly counterService: CounterService,
    private readonly auditLogService: AuditLogService,
    private readonly notificationsService: NotificationsService,
    private readonly appRealtimeService: AppRealtimeService,
  ) {}

  async create(
    sellerId: string,
    dto: CreateListingDto,
  ): Promise<ListingDocument> {
    await this.categoriesService.findById(dto.categoryId);
    const { hasDefect, defectDescription } = this.resolveDefectFields(dto, {
      hasDefect: false,
      defectDescription: null,
    });
    const slug = await this.counterService.nextSlug('listing', 'LST', 4);
    const images = this.resolveMediaAssets(dto.images);
    const listing = await this.listingModel.create({
      seller: sellerId,
      title: dto.title,
      description: dto.description,
      category: dto.categoryId,
      condition: dto.condition,
      price: dto.price,
      images,
      mainImageUrl: this.pickMainImageUrl(images),
      video: dto.video ? this.resolveMediaAsset(dto.video) : undefined,
      location: {
        type: 'Point',
        coordinates: [dto.location.lng, dto.location.lat],
      },
      locationLabel: `${dto.area}, ${dto.state}`,
      address: dto.address,
      state: dto.state,
      area: dto.area,
      hasDefect,
      defectDescription,
      specs: dto.brand ? { brand: dto.brand } : undefined,
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
    this.appRealtimeService.broadcastNewListing(sellerId, {
      listingId: listing._id.toString(),
      title: listing.title,
      price: listing.price,
      mainImageUrl: listing.mainImageUrl,
    });
    return listing;
  }

  async findById(id: string): Promise<ListingDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Listing not found');
    }
    const listing = await this.listingModel
      .findOne({ _id: id })
      .populate('category', CATEGORY_POPULATE_FIELDS);
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  // Display-only variant of findById() — accepts either a raw id or a
  // LST-#### slug, seller populated and reshaped for the public
  // single-listing GET. Deliberately separate from findById() itself:
  // TransactionsService calls findById() internally and reads listing.seller
  // as a raw ObjectId (ownership checks, seller lookups) — populating seller
  // there would silently corrupt those .toString() comparisons.
  async findByIdForDisplay(
    idOrSlug: string,
    requesterId: string,
  ): Promise<Record<string, unknown>> {
    const filter = isValidObjectId(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: idOrSlug };
    const listing = await this.listingModel
      .findOne(filter)
      .populate('category', CATEGORY_POPULATE_FIELDS)
      .populate('seller', SELLER_POPULATE_FIELDS);
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    // Paused is a draft state — invisible to everyone except its owner, not
    // just excluded from discovery feeds like sold/flagged are.
    // 404, not 403 — a non-owner shouldn't be able to tell the difference
    // between "doesn't exist" and "exists but is someone's paused draft."
    // listing.seller is already populated by this point (the query above),
    // so it's a seller sub-document, not a raw ObjectId — .toString() on it
    // would never match requesterId; read its _id instead.
    const sellerId = (listing.seller as unknown as PopulatedSeller)?._id;
    if (
      listing.status === ListingStatus.PAUSED &&
      sellerId?.toString() !== requesterId
    ) {
      throw new NotFoundException('Listing not found');
    }
    const [shaped] = await this.attachSellerSummaries([listing]);

    // phoneNumber/totalSales/profileImageUrl are only enriched here, not in
    // the shared shapeSellerSummary()/attachSellerSummaries() used by
    // list/nearby/new/mine — totalSales needs its own query per seller,
    // which is fine for a single detail view but would be an N+1 query on
    // a 20-row search page (phoneNumber/profileImageUrl are free, already
    // part of the same seller populate, but kept local for consistency
    // with the "listing details only" scope of this ask).
    const seller = listing.seller as unknown as PopulatedSeller | null;
    if (seller && shaped.seller) {
      const totalSales = await this.listingModel.countDocuments({
        seller: seller._id,
        status: ListingStatus.SOLD,
      });
      Object.assign(shaped.seller as Record<string, unknown>, {
        phoneNumber: seller.phone,
        totalSales,
        profileImageUrl: seller.profileImage,
      });
    }

    return shaped;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateListingDto,
  ): Promise<ListingDocument> {
    const listing = await this.findOwned(id, userId);
    this.assertActive(listing);
    const changedFields = await this.applyUpdate(listing, dto);
    if (changedFields.length > 0) {
      await this.auditLogService.record({
        entityType: 'listing',
        entityId: id,
        event: 'listing.updated',
        actor: userId,
        metadata: { fields: changedFields },
      });
      this.appRealtimeService.emitListingChanged(id, userId, 'updated');
    }
    return listing;
  }

  // Bypasses ownership — an admin can edit any listing. Distinct audit event
  // (`updated_by_admin`) so the trail shows who actually made the change.
  async adminUpdate(
    id: string,
    adminId: string,
    dto: UpdateListingDto,
  ): Promise<ListingDocument> {
    const listing = await this.adminFindById(id);
    const changedFields = await this.applyUpdate(listing, dto);
    if (changedFields.length > 0) {
      await this.auditLogService.record({
        entityType: 'listing',
        entityId: id,
        event: 'listing.updated_by_admin',
        actor: adminId,
        metadata: { fields: changedFields },
      });
      this.appRealtimeService.emitListingChanged(
        id,
        listing.seller.toString(),
        'updated',
      );
    }
    return listing;
  }

  private async applyUpdate(
    listing: ListingDocument,
    dto: UpdateListingDto,
  ): Promise<string[]> {
    if (dto.categoryId !== undefined) {
      await this.categoriesService.findById(dto.categoryId);
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
    if (dto.categoryId !== undefined) {
      listing.category = new Types.ObjectId(dto.categoryId);
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
      listing.images = this.resolveMediaAssets(dto.images);
      listing.mainImageUrl = this.pickMainImageUrl(listing.images);
      changedFields.push('images', 'mainImageUrl');
    }
    if (dto.video !== undefined) {
      listing.video = this.resolveMediaAsset(dto.video);
      changedFields.push('video');
    }
    if (dto.brand !== undefined) {
      listing.specs = { ...listing.specs, brand: dto.brand };
      changedFields.push('specs');
    }
    if (dto.address !== undefined) {
      listing.address = dto.address;
      changedFields.push('address');
    }
    if (dto.state !== undefined) {
      listing.state = dto.state;
      changedFields.push('state');
    }
    if (dto.area !== undefined) {
      listing.area = dto.area;
      changedFields.push('area');
    }
    // Recomputed whenever either half changes — the other half falls back to its already-stored value. An old listing with no stored `area` (it wasn't part of creation until 2026-09-02) falls back to `state` alone rather than emitting "undefined, ...".
    if (dto.area !== undefined || dto.state !== undefined) {
      const area = dto.area ?? listing.area;
      const state = dto.state ?? listing.state ?? '';
      listing.locationLabel = area ? `${area}, ${state}` : state;
      changedFields.push('locationLabel');
    }
    if (dto.location !== undefined) {
      listing.location = {
        type: 'Point',
        coordinates: [dto.location.lng, dto.location.lat],
      };
      changedFields.push('location');
    }
    if (dto.hasDefect !== undefined || dto.defectDescription !== undefined) {
      const { hasDefect, defectDescription } = this.resolveDefectFields(dto, {
        hasDefect: listing.hasDefect,
        defectDescription: listing.defectDescription,
      });
      listing.hasDefect = hasDefect;
      listing.defectDescription = defectDescription;
      changedFields.push('hasDefect', 'defectDescription');
    }

    await listing.save();
    return changedFields;
  }

  // Shared by create() and applyUpdate() — hasDefect:false always clears defectDescription; hasDefect:true requires one (falling back to what's already stored, if any).
  private resolveDefectFields(
    dto: { hasDefect?: boolean; defectDescription?: string | null },
    current: { hasDefect: boolean; defectDescription: string | null },
  ): { hasDefect: boolean; defectDescription: string | null } {
    const hasDefect = dto.hasDefect ?? current.hasDefect;
    if (!hasDefect) {
      return { hasDefect: false, defectDescription: null };
    }

    const defectDescription =
      dto.defectDescription !== undefined
        ? dto.defectDescription
        : current.defectDescription;
    if (!defectDescription) {
      throw new BadRequestException(
        'defectDescription is required when hasDefect is true',
      );
    }
    return { hasDefect: true, defectDescription };
  }

  // sortOrder defaults to array index, isPrimary to false, createdAt to now — only when the client didn't already supply them.
  private resolveMediaAsset(dto: MediaAssetDto, sortOrder = 0): MediaAsset {
    return {
      publicId: dto.publicId,
      url: dto.url,
      secureUrl: dto.secureUrl,
      sortOrder: dto.sortOrder ?? sortOrder,
      isPrimary: dto.isPrimary ?? false,
      createdAt: dto.createdAt ? new Date(dto.createdAt) : new Date(),
    };
  }

  private resolveMediaAssets(items: MediaAssetDto[]): MediaAsset[] {
    return items.map((item, index) => this.resolveMediaAsset(item, index));
  }

  // Whichever image is isPrimary (first one, if more than one is marked), falling back to the first image if none are.
  private pickMainImageUrl(images: MediaAsset[]): string | undefined {
    return (images.find((i) => i.isPrimary) ?? images[0])?.secureUrl;
  }

  // One counted view per (user, listing) per 24 hrs — repeat opens within the window are no-ops, not a fresh increment. ListingView holds one row per (user, listing), updated in place rather than logged per-view.
  async registerView(
    idOrSlug: string,
    userId: string,
  ): Promise<{ counted: boolean; views: number }> {
    const listing = await this.findRawByIdOrSlug(idOrSlug);
    const listingId = listing._id;
    const whenCanView = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const existing = await this.listingViewModel.findOne({
      user: userId,
      listing: listingId,
    });

    if (existing) {
      if (existing.lastViewedAt > whenCanView) {
        return { counted: false, views: listing.views };
      }
      existing.lastViewedAt = new Date();
      await existing.save();
    } else {
      try {
        await this.listingViewModel.create({
          user: userId,
          listing: listingId,
          lastViewedAt: new Date(),
        });
      } catch (err) {
        // Duplicate-key race (two near-simultaneous opens creating the same (user, listing) row) — treat the loser as "not counted this call"
        // rather than erroring, same pattern ReviewsService uses for 11000.
        if ((err as { code?: number }).code === 11000) {
          return { counted: false, views: listing.views };
        }
        throw err;
      }
    }

    const updated = await this.listingModel
      .findByIdAndUpdate(listingId, { $inc: { views: 1 } }, { new: true })
      .select('views');
    return { counted: true, views: updated?.views ?? listing.views + 1 };
  }

  // Raw variant of findByIdForDisplay() — no populate/reshape, for callers
  // that only need the document itself.
  private async findRawByIdOrSlug(idOrSlug: string): Promise<ListingDocument> {
    const filter = isValidObjectId(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: idOrSlug };
    const listing = await this.listingModel.findOne(filter);
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  // Owner-only draft state — see the ListingStatus.PAUSED comment on the
  // schema and findByIdForDisplay()'s visibility check above. Only from
  // active, same as edit/delete — explicit instruction.
  async pause(id: string, userId: string): Promise<ListingDocument> {
    const listing = await this.findOwned(id, userId);
    this.assertActive(listing);
    const oldState = listing.status;
    listing.status = ListingStatus.PAUSED;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.paused',
      actor: userId,
      oldState,
      newState: listing.status,
    });
    // broadcastPublic:false — a paused listing is a private draft, nobody but the owner should learn it changed state.
    this.appRealtimeService.emitListingStatusChange(
      id,
      userId,
      { status: listing.status, oldStatus: oldState },
      false,
    );
    return listing;
  }

  // Only from PAUSED — resuming a listing that's, say, sold
  // doesn't make sense, same "only from the expected starting status" guard
  // unflag()/relist() already use.
  async resume(id: string, userId: string): Promise<ListingDocument> {
    const listing = await this.findOwned(id, userId);
    if (listing.status !== ListingStatus.PAUSED) {
      throw new BadRequestException('Only a paused listing can be resumed');
    }
    const oldState = listing.status;
    listing.status = ListingStatus.ACTIVE;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.resumed',
      actor: userId,
      oldState,
      newState: listing.status,
    });
    // broadcastPublic:false for symmetry with pause() — nobody could have been subscribed to this listing's room while it was paused anyway.
    this.appRealtimeService.emitListingStatusChange(
      id,
      userId,
      { status: listing.status, oldStatus: oldState },
      false,
    );
    return listing;
  }

  // Real hard delete — the DELETED status/soft-delete mechanism was removed
  // 2026-09-12, explicit instruction ("only active status listing[s] can be
  // deleted... remove deleted status and implementation"). Only reachable
  // from `active` (assertActive() above), which limits but doesn't fully
  // eliminate the risk this reverses from the original soft-delete design —
  // a `cancelled`/`refunded` Transaction can still reference a listing that
  // is currently `active` (and thus deletable); its `listing` ref goes
  // dangling from here on, resolving to null on populate() like every other
  // dangling ref in this app already degrades. Accepted trade-off, flagged.
  async remove(id: string, userId: string): Promise<void> {
    const listing = await this.findOwned(id, userId);
    this.assertActive(listing);
    const oldState = listing.status;
    await listing.deleteOne();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.deleted',
      actor: userId,
      oldState,
      newState: 'deleted',
    });
    this.appRealtimeService.emitListingChanged(id, userId, 'deleted');
  }

  // Proximity feed, now also accepting the shared categoryId/itemCondition/priceRange/address/state/area filters (no search); $facet forks one $geoNear into page + total since countDocuments() can't use $near.
  // Excludes the caller's own listings — a seller browses everyone else's, and gets their own via GET /listings/mine.
  async nearby(
    dto: NearbyListingsDto,
    currentUserId: string,
  ): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const radiusKm = dto.radiusKm ?? 5;
    const refundedListingIds = await this.getRefundedListingIds(currentUserId);

    const { results, total } = await this.geoPaginatedListings(
      dto.lat,
      dto.lng,
      radiusKm * 1000,
      {
        status: ListingStatus.ACTIVE,
        seller: { $ne: new Types.ObjectId(currentUserId) },
        _id: { $nin: refundedListingIds },
        ...this.buildExtraFilters(dto),
      },
      page,
      limit,
    );

    return { results, total, page, limit };
  }

  // Shared by nearby() and filterListings() — one $geoNear+$facet pipeline, so a bug fix here never has to be repeated elsewhere.
  private async geoPaginatedListings(
    lat: number,
    lng: number,
    maxDistanceMeters: number | undefined,
    baseFilter: Record<string, unknown>,
    page: number,
    limit: number,
  ): Promise<{ results: Record<string, unknown>[]; total: number }> {
    const [agg] = await this.listingModel.aggregate<{
      results: (ListingDocument & { seller?: PopulatedSeller })[];
      totalCount: { count: number }[];
    }>([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distanceMeters',
          ...(maxDistanceMeters !== undefined && {
            maxDistance: maxDistanceMeters,
          }),
          spherical: true,
          query: baseFilter,
        },
      },
      {
        $facet: {
          results: [
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
            // preserveNullAndEmptyArrays keeps a listing with a dangling ref, matching .populate()'s null-not-dropped behavior elsewhere.
            {
              $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
            },
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
                      hasPayoutDetails: 1,
                    },
                  },
                ],
              },
            },
            { $unwind: { path: '$seller', preserveNullAndEmptyArrays: true } },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ]);

    const total = agg.totalCount[0]?.count ?? 0;
    const sellerIds = agg.results
      .map((r) => r.seller?._id?.toString())
      .filter((id): id is string => !!id);
    const counts = await this.countsBySeller([...new Set(sellerIds)]);
    const results = agg.results.map((r) => ({
      ...r,
      seller: this.shapeSellerSummary(
        r.seller ?? null,
        r.seller ? (counts.get(r.seller._id.toString())?.total ?? 0) : 0,
      ),
    }));

    return { results, total };
  }

  // Recently posted feed — createdAt within the last 7 days, newest first. Now also accepting the shared categoryId/itemCondition/priceRange/address/state/area filters (no search).
  // Excludes the caller's own listings — a seller browses everyone else's, and gets their own via GET /listings/mine.
  async recent(
    dto: RecentListingsDto,
    currentUserId: string,
  ): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const since = new Date();
    since.setDate(since.getDate() - RECENT_LISTINGS_DAYS);
    const refundedListingIds = await this.getRefundedListingIds(currentUserId);

    const filter: Record<string, unknown> = {
      status: ListingStatus.ACTIVE,
      createdAt: { $gte: since },
      seller: { $ne: new Types.ObjectId(currentUserId) },
      _id: { $nin: refundedListingIds },
      ...this.buildExtraFilters(dto),
    };

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

  // useMyLocation has no stored fallback (no location on User) — lat/lng must come from the client's device GPS.
  private assertLocationParams(dto: ListingFilterDto): void {
    if (dto.useMyLocation && (dto.lat === undefined || dto.lng === undefined)) {
      throw new BadRequestException(
        'lat and lng are required when useMyLocation is true',
      );
    }
  }

  // Discovery feeds only — a buyer who had a purchase REFUNDED (either their
  // own cancel-purchase, or an admin resolving a stalled/disputed one)
  // already decided not to go through with that listing; don't keep
  // resurfacing it. Deliberately not the pre-payment `cancelled` status —
  // that listing never left `active` in the first place, no "it came back"
  // story to hide. One small indexed query per request (Transaction.buyer
  // is indexed, and a buyer's own transaction count is naturally small and
  // bounded — this never scans the whole collection), not a per-row cost,
  // so it doesn't add meaningfully to fetch time.
  private async getRefundedListingIds(
    userId: string,
  ): Promise<Types.ObjectId[]> {
    return this.transactionModel.distinct('listing', {
      buyer: userId,
      status: TransactionStatus.REFUNDED,
    });
  }

  // Shared by every listing feed (search/filter, nearby, new) — categoryId/itemCondition/priceRange/address/state/area, so a bug fix here never has to be repeated across the three call sites.
  private buildExtraFilters(
    dto: ListingExtraFiltersDto,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    if (dto.categoryId) filter.category = new Types.ObjectId(dto.categoryId);

    const conditions: ListingCondition[] = [];
    if (dto.itemCondition?.new) conditions.push(ListingCondition.NEW);
    if (dto.itemCondition?.neatlyUsed) {
      conditions.push(ListingCondition.NEATLY_USED);
    }
    if (conditions.length > 0) filter.condition = { $in: conditions };

    if (
      dto.priceRange?.min !== undefined ||
      dto.priceRange?.max !== undefined
    ) {
      filter.price = {
        ...(dto.priceRange.min !== undefined && { $gte: dto.priceRange.min }),
        ...(dto.priceRange.max !== undefined && { $lte: dto.priceRange.max }),
      };
    }

    if (dto.address) filter.address = new RegExp(escapeRegex(dto.address), 'i');
    if (dto.state) filter.state = new RegExp(escapeRegex(dto.state), 'i');
    if (dto.area) filter.area = new RegExp(escapeRegex(dto.area), 'i');

    return filter;
  }

  // Backs filterListings() — no longer shared with a countFiltered() (that method is gone, see countNearby() below).
  // Excludes the caller's own listings — a seller browses everyone else's, and gets their own via GET /listings/mine.
  private async buildListingFilterQuery(
    dto: ListingFilterDto,
    currentUserId: string,
  ): Promise<Record<string, unknown>> {
    const extra = this.buildExtraFilters(dto);
    // Text location fields only apply on the non-geo path — useMyLocation switches to $geoNear instead.
    if (dto.useMyLocation) {
      delete extra.address;
      delete extra.state;
      delete extra.area;
    }
    const refundedListingIds = await this.getRefundedListingIds(currentUserId);

    const filter: Record<string, unknown> = {
      status: ListingStatus.ACTIVE,
      seller: { $ne: new Types.ObjectId(currentUserId) },
      _id: { $nin: refundedListingIds },
      ...extra,
    };

    // Case-insensitive regex against title/description, not Mongo's $text index — no relevance ranking, just a substring match.
    if (dto.search) {
      const re = new RegExp(escapeRegex(dto.search), 'i');
      filter.$or = [{ title: re }, { description: re }];
    }

    return filter;
  }

  // Count of active listings within radiusKm (default 5) of (lat, lng) — the count endpoint's whole job now, not a mirror of every /listings filter.
  // Excludes the caller's own listings, matching nearby() — the count should describe what nearby() would actually return for this caller.
  async countNearby(
    lat: number,
    lng: number,
    radiusKm: number,
    currentUserId: string,
  ): Promise<{ count: number }> {
    const refundedListingIds = await this.getRefundedListingIds(currentUserId);
    const [row] = await this.listingModel.aggregate<{ count: number }>([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distanceMeters',
          maxDistance: radiusKm * 1000,
          spherical: true,
          query: {
            status: ListingStatus.ACTIVE,
            seller: { $ne: new Types.ObjectId(currentUserId) },
            _id: { $nin: refundedListingIds },
          },
        },
      },
      { $count: 'count' },
    ]);
    return { count: row?.count ?? 0 };
  }

  // Backs GET /listings' pagination — the search/filter data endpoint.
  async filterListings(
    dto: FilterListingsDto,
    currentUserId: string,
  ): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    this.assertLocationParams(dto);
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const baseFilter = await this.buildListingFilterQuery(dto, currentUserId);

    if (dto.useMyLocation) {
      const { results, total } = await this.geoPaginatedListings(
        dto.lat!,
        dto.lng!,
        dto.searchWithin !== undefined ? dto.searchWithin * 1000 : undefined,
        baseFilter,
        page,
        limit,
      );
      return { results, total, page, limit };
    }

    // Regex has no relevance score to sort by (unlike the old $text search) — newest first regardless of whether `search` is present.
    const query = this.listingModel
      .find(baseFilter)
      .populate('category', CATEGORY_POPULATE_FIELDS)
      .populate('seller', SELLER_POPULATE_FIELDS)
      .sort({ createdAt: -1 });
    const [found, total] = await Promise.all([
      query
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.listingModel.countDocuments(baseFilter),
    ]);
    const results = await this.attachSellerSummaries(found);

    return { results, total, page, limit };
  }

  // Unlike search()/findById(), admin visibility includes every status
  // except paused — an admin investigating a report or a dispute needs to
  // see the listing regardless of its other lifecycle states, but a paused
  // listing is a private seller draft, invisible to admin too (2026-09-13,
  // explicit instruction — narrows the earlier "admin sees everything"
  // precedent specifically for this one status).
  async adminList(
    page: number,
    limit: number,
    status?: ListingStatus,
    search?: string,
    dateRange: DateRangeDto = {},
  ): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: Record<string, unknown> = {
      status: status ?? { $ne: ListingStatus.PAUSED },
      ...buildDateRangeFilter(dateRange),
    };
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
    const results = found.map((l) => this.shapeAdminListingRow(l));
    return { results, total, page, limit };
  }

  // Lean row shape for the admin listings table — drops fields that only
  // matter on the detail view (location, views, saves, priceHistory,
  // condition) and trims category/seller down to what a table row needs.
  private shapeAdminListingRow(
    listing: ListingDocument,
  ): Record<string, unknown> {
    const obj = listing.toObject() as unknown as Record<string, unknown>;
    delete obj.location;
    delete obj.views;
    delete obj.saves;
    delete obj.priceHistory;
    delete obj.condition;

    const category = obj.category as
      { _id: Types.ObjectId; title?: string } | undefined;
    if (category) {
      obj.category = { _id: category._id, title: category.title };
    }

    const seller = obj.seller as PopulatedSeller | undefined;
    if (seller) {
      obj.seller = {
        _id: seller._id,
        name: seller.name,
        company: seller.company,
      };
    }

    return obj;
  }

  // Unpaginated (full matching set) and flattened rather than reusing attachSellerSummaries() — a nested-object CSV cell is unreadable.
  async exportCsv(
    status?: ListingStatus,
    search?: string,
    dateRange: DateRangeDto = {},
  ): Promise<string> {
    const filter: Record<string, unknown> = {
      ...(status ? { status } : {}),
      ...buildDateRangeFilter(dateRange),
    };
    if (search) {
      filter.title = new RegExp(escapeRegex(search), 'i');
    }
    const found = await this.listingModel
      .find(filter)
      .populate('category', CATEGORY_POPULATE_FIELDS)
      .populate('seller', SELLER_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .exec();

    const rows = found.map((l) => {
      const category = l.category as unknown as { title?: string } | undefined;
      const seller = l.seller as unknown as
        { name?: string; phone?: string } | undefined;
      return {
        id: l._id.toString(),
        slug: l.slug ?? '',
        title: l.title,
        category: category?.title ?? '',
        condition: l.condition,
        price: l.price,
        status: l.status,
        sellerName: seller?.name ?? '',
        sellerPhone: seller?.phone ?? '',
        views: l.views,
        saves: l.saves,
        createdAt: (l as unknown as { createdAt: Date }).createdAt,
      };
    });

    return toCsv(rows, [
      'id',
      'slug',
      'title',
      'category',
      'condition',
      'price',
      'status',
      'sellerName',
      'sellerPhone',
      'views',
      'saves',
      'createdAt',
    ]);
  }

  // Used by the admin Users federated list/detail view — counts all
  // listings regardless of status (a suspended seller's history
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

  // Backs the admin Dashboard "New Listings" card's main value (period-scoped) and its fixed weekly extra.
  countCreatedInRange(since?: Date, until?: Date): Promise<number> {
    const filter = since
      ? { createdAt: until ? { $gte: since, $lt: until } : { $gte: since } }
      : {};
    return this.listingModel.countDocuments(filter).exec();
  }

  // Backs the admin Dashboard "listings per month" chart's all-time total —
  // sum of asking price across every listing (deleted listings no longer
  // exist as documents at all — see the DELETED-status removal note above).
  async sumTotalValue(): Promise<number> {
    const rows = await this.listingModel.aggregate<{
      _id: null;
      total: number;
    }>([{ $group: { _id: null, total: { $sum: '$price' } } }]);
    return Math.round((rows[0]?.total ?? 0) * 100) / 100;
  }

  // Same chart's monthly bars — rolling window of `monthsBack` months up to and including the current one, zero-filled. totalListing is a count, listingWorth is summed by listing.price.
  async sumValueByMonth(
    monthsBack: number,
  ): Promise<
    Array<{ month: string; totalListing: number; listingWorth: number }>
  > {
    const now = new Date();
    const buckets: { year: number; month: number }[] = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }
    const since = new Date(buckets[0].year, buckets[0].month - 1, 1);

    const rows = await this.listingModel.aggregate<{
      _id: { year: number; month: number };
      totalListing: number;
      listingWorth: number;
    }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          totalListing: { $sum: 1 },
          listingWorth: { $sum: '$price' },
        },
      },
    ]);
    const byMonth = new Map(
      rows.map((r) => [
        `${r._id.year}-${r._id.month}`,
        { totalListing: r.totalListing, listingWorth: r.listingWorth },
      ]),
    );

    return buckets.map((b) => {
      const bucket = byMonth.get(`${b.year}-${b.month}`);
      return {
        month: MONTH_ABBREVIATIONS[b.month - 1],
        totalListing: bucket?.totalListing ?? 0,
        listingWorth: Math.round((bucket?.listingWorth ?? 0) * 100) / 100,
      };
    });
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
    return this.adminFindDetail({ slug });
  }

  async adminFindByIdDetail(id: string): Promise<{
    listing: ListingDocument;
    recentActivity: Awaited<ReturnType<AuditLogService['findForEntity']>>;
  }> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Listing not found');
    }
    return this.adminFindDetail({ _id: id });
  }

  private async adminFindDetail(filter: Record<string, unknown>): Promise<{
    listing: ListingDocument;
    recentActivity: Awaited<ReturnType<AuditLogService['findForEntity']>>;
  }> {
    const listing = await this.listingModel
      .findOne(filter)
      .populate('category', CATEGORY_POPULATE_FIELDS)
      .exec();
    // Paused is a private seller draft, invisible to admin too (2026-09-13,
    // explicit instruction) — 404, matching the non-owner-user behavior on
    // findByIdForDisplay(), rather than exposing that a paused listing
    // exists at all under this id/slug.
    if (!listing || listing.status === ListingStatus.PAUSED) {
      throw new NotFoundException('Listing not found');
    }
    const recentActivity = await this.auditLogService.findForEntity(
      'listing',
      listing._id.toString(),
      3,
    );
    return { listing, recentActivity };
  }

  // Called by TransactionsService the moment a payment is verified (webhook),
  // before the transaction reaches escrow_active — takes the listing out of
  // ACTIVE so it disappears from search/checkout the instant it's paid for,
  // not just once the physical handover happens (see markSold() below).
  // Atomic (findOneAndUpdate conditioned on the current status) so two
  // webhooks racing for the same listing can't both "win" — only the first
  // to land actually claims it; the caller checks the boolean to know which.
  async markPendingSale(id: string): Promise<boolean> {
    const listing = await this.listingModel.findOneAndUpdate(
      { _id: id, status: ListingStatus.ACTIVE },
      { status: ListingStatus.PENDING_SALE },
    );
    if (!listing) return false;
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.pending_sale',
      actor: 'system',
      oldState: ListingStatus.ACTIVE,
      newState: ListingStatus.PENDING_SALE,
    });
    this.appRealtimeService.emitListingStatusChange(
      id,
      listing.seller.toString(),
      { status: ListingStatus.PENDING_SALE, oldStatus: ListingStatus.ACTIVE },
    );
    return true;
  }

  // Reverses markPendingSale() when a reserved transaction ends up refunded
  // instead of completed. Only flips PENDING_SALE back to ACTIVE — never
  // SOLD (terminal) or anything else an admin may have set in the meantime.
  async revertToActive(id: string): Promise<void> {
    const listing = await this.listingModel.findOneAndUpdate(
      { _id: id, status: ListingStatus.PENDING_SALE },
      { status: ListingStatus.ACTIVE },
    );
    if (!listing) return;
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.reactivated',
      actor: 'system',
      oldState: ListingStatus.PENDING_SALE,
      newState: ListingStatus.ACTIVE,
    });
    this.appRealtimeService.emitListingStatusChange(
      id,
      listing.seller.toString(),
      { status: ListingStatus.ACTIVE, oldStatus: ListingStatus.PENDING_SALE },
    );
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
    this.appRealtimeService.emitListingStatusChange(
      id,
      listing.seller.toString(),
      { status: listing.status, oldStatus: oldState },
    );
  }

  // Renamed from flag() 2026-09-12 — see the ListingStatus.REPORTED comment
  // on the schema. Called both by ReportsService.create() (a user filing a
  // report) and directly by an admin (PATCH /admin/listings/:id/report).
  async report(id: string, adminId: string): Promise<ListingDocument> {
    const listing = await this.adminFindById(id);
    const oldState = listing.status;
    listing.status = ListingStatus.REPORTED;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.reported',
      actor: adminId,
      oldState,
      newState: listing.status,
    });

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: listing.seller.toString(),
      type: 'listing_reported',
      title: 'Your listing was reported',
      body: `Your listing "${listing.title}" was reported and is under review.`,
      data: { listingId: id, title: listing.title },
    });
    this.appRealtimeService.emitListingStatusChange(
      id,
      listing.seller.toString(),
      { status: listing.status, oldStatus: oldState },
    );

    return listing;
  }

  // Renamed from unflag() 2026-09-12.
  async unreport(id: string, adminId: string): Promise<ListingDocument> {
    const listing = await this.adminFindById(id);
    if (listing.status !== ListingStatus.REPORTED) {
      throw new BadRequestException(
        'Only a reported listing can be un-reported',
      );
    }
    const oldState = listing.status;
    listing.status = ListingStatus.ACTIVE;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.unreported',
      actor: adminId,
      oldState,
      newState: listing.status,
    });
    this.appRealtimeService.emitListingStatusChange(
      id,
      listing.seller.toString(),
      { status: listing.status, oldStatus: oldState },
    );
    return listing;
  }

  async delist(id: string, adminId: string): Promise<ListingDocument> {
    const listing = await this.adminFindById(id);
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only an active listing can be delisted');
    }
    const oldState = listing.status;
    listing.status = ListingStatus.DELISTED;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.delisted',
      actor: adminId,
      oldState,
      newState: listing.status,
    });

    await this.notificationsService.notify({
      recipientType: NotificationRecipientType.USER,
      recipientId: listing.seller.toString(),
      type: 'listing_unlisted',
      title: 'Your listing was unlisted',
      body: `Your listing "${listing.title}" was taken down by an admin.`,
    });
    this.appRealtimeService.emitListingStatusChange(
      id,
      listing.seller.toString(),
      { status: listing.status, oldStatus: oldState },
    );

    return listing;
  }

  async relist(id: string, adminId: string): Promise<ListingDocument> {
    const listing = await this.adminFindById(id);
    if (listing.status !== ListingStatus.DELISTED) {
      throw new BadRequestException('Only a delisted listing can be relisted');
    }
    const oldState = listing.status;
    listing.status = ListingStatus.ACTIVE;
    await listing.save();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.relisted',
      actor: adminId,
      oldState,
      newState: listing.status,
    });
    this.appRealtimeService.emitListingStatusChange(
      id,
      listing.seller.toString(),
      { status: listing.status, oldStatus: oldState },
    );
    return listing;
  }

  // Admin removal — same soft-delete mechanism as a seller's own delete,
  // just without the ownership check.
  // Real hard delete, same as the owner's own remove() above — admin removal
  // is deliberately not restricted to `active` (an admin needs to be able to
  // remove a listing regardless of its current lifecycle state).
  async adminRemove(id: string, adminId: string): Promise<void> {
    const listing = await this.adminFindById(id);
    const oldState = listing.status;
    const sellerId = listing.seller.toString();
    await listing.deleteOne();
    await this.auditLogService.record({
      entityType: 'listing',
      entityId: id,
      event: 'listing.deleted_by_admin',
      actor: adminId,
      oldState,
      newState: 'deleted',
    });
    this.appRealtimeService.emitListingChanged(id, sellerId, 'deleted');
  }

  // Friendly GET /listings/mine filter keys → real ListingStatus.
  private static readonly MY_LISTING_STATUS_MAP: Record<
    MyListingStatusFilter,
    ListingStatus
  > = {
    active: ListingStatus.ACTIVE,
    pending_sale: ListingStatus.PENDING_SALE,
    sold: ListingStatus.SOLD,
    reported: ListingStatus.REPORTED,
    paused: ListingStatus.PAUSED,
  };

  // Takes an already-resolved seller id — resolving a USR-#### slug to an
  // id is UsersService's job (see AdminService.getListingsByUser). `status`
  // is optional and only used by the user-facing GET /listings/mine — the
  // admin by-user caller never passes it, so its own "every non-deleted
  // status" behavior is otherwise unchanged. `excludePaused` is the one
  // exception: the admin caller passes `true` (paused is a private seller
  // draft, invisible to admin too, 2026-09-13 explicit instruction) while
  // GET /listings/mine leaves it `false` — the owner must still see (and
  // filter to) their own paused drafts.
  async byUser(
    sellerId: string,
    page: number,
    limit: number,
    dateRange: DateRangeDto = {},
    status?: MyListingStatusFilter,
    excludePaused = false,
  ): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = {
      seller: sellerId,
      ...(status
        ? { status: ListingsService.MY_LISTING_STATUS_MAP[status] }
        : excludePaused
          ? { status: { $ne: ListingStatus.PAUSED } }
          : {}),
      ...buildDateRangeFilter(dateRange),
    };
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

  // Shared by update()/remove()/pause() — explicit instruction: only an
  // active listing can be edited, deleted, or paused. resume() has its own,
  // opposite guard (only from paused) and doesn't use this.
  private assertActive(listing: ListingDocument): void {
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException(
        `Listing is ${listing.status} — only an active listing can be edited, deleted, or paused`,
      );
    }
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
      hasPayoutDetails: seller.hasPayoutDetails ?? false,
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
