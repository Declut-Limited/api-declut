import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { Listing, ListingDocument } from '../listings/schemas/listing.schema';
import { getAuditIpAddress } from './audit-log-context';
import { describeEvent } from './event-labels';
import { UsersService } from '../users/users.service';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { CounterService } from '../common/counter/counter.service';
import { toCsv } from '../common/utils/csv.util';

interface ActorSummary {
  id: string;
  name: string;
  role: 'User' | 'Admin' | 'System';
  image?: string;
}

interface ActorDetail extends ActorSummary {
  email?: string;
  status?: string;
  createdAt?: Date;
  rating?: number;
  company?: string;
  totalListings?: number;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
    private readonly usersService: UsersService,
    private readonly adminAuthService: AdminAuthService,
    private readonly counterService: CounterService,
  ) {}

  async record(params: {
    entityType: string;
    entityId: string;
    event: string;
    actor: string;
    oldState?: string;
    newState?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const slug = await this.counterService.nextSlug('activity_log', 'LOG', 4);
    await this.auditLogModel.create({
      ...params,
      slug,
      ipAddress: getAuditIpAddress(),
    });
  }

  findForEntity(
    entityType: string,
    entityId: string,
    limit = 20,
  ): Promise<AuditLogDocument[]> {
    return this.auditLogModel
      .find({ entityType, entityId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  // Backs the admin Activity Log page — every event across every entity
  // type, newest first, optionally narrowed to one entityType.
  async list(
    page: number,
    limit: number,
    entityType?: string,
  ): Promise<{
    results: AuditLogDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = entityType ? { entityType } : {};
    const [results, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.auditLogModel.countDocuments(filter),
    ]);
    return { results, total, page, limit };
  }

  async findById(id: string): Promise<AuditLogDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Activity log entry not found');
    }
    const entry = await this.auditLogModel.findById(id).exec();
    if (!entry) {
      throw new NotFoundException('Activity log entry not found');
    }
    return entry;
  }

  // Enriched variant of list() for GET /admin/activity-log itself — readable
  // label, actor summary, and target — kept separate from list() above so
  // AdminService.getRecentActivity() (which needs the raw shape) is unaffected.
  async listWithDetails(
    page: number,
    limit: number,
    entityType?: string,
  ): Promise<{
    results: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { results, total } = await this.list(page, limit, entityType);
    const shaped = await Promise.all(results.map((r) => this.shapeSummary(r)));
    return { results: shaped, total, page, limit };
  }

  async findByIdWithDetails(id: string): Promise<Record<string, unknown>> {
    const entry = await this.findById(id);
    const obj = entry.toObject() as unknown as Record<string, unknown>;
    return {
      ...obj,
      label: describeEvent(entry.event),
      target: { type: entry.entityType, id: entry.entityId.toString() },
      actor: await this.resolveActorDetail(entry.actor),
    };
  }

  async remove(id: string): Promise<void> {
    const entry = await this.findById(id);
    await entry.deleteOne();
  }

  // Unpaginated and flattened, same convention as every other export in this app. Actor stays a raw id/string rather than resolved to a name — resolving each row would mean an N+1 lookup per row across a potentially large unpaginated set; the paginated list view already pays that cost at 20 rows/page, this export doesn't.
  async exportCsv(entityType?: string): Promise<string> {
    const filter = entityType ? { entityType } : {};
    const rows = await this.auditLogModel
      .find(filter)
      .sort({ createdAt: -1 })
      .exec();

    const shaped = rows.map((r) => ({
      slug: r.slug ?? '',
      entityType: r.entityType,
      entityId: r.entityId.toString(),
      event: describeEvent(r.event),
      actor: r.actor,
      oldState: r.oldState ?? '',
      newState: r.newState ?? '',
      ipAddress: r.ipAddress ?? '',
      createdAt: r.createdAt,
    }));

    return toCsv(shaped, [
      'slug',
      'entityType',
      'entityId',
      'event',
      'actor',
      'oldState',
      'newState',
      'ipAddress',
      'createdAt',
    ]);
  }

  private async shapeSummary(
    entry: AuditLogDocument,
  ): Promise<Record<string, unknown>> {
    const obj = entry.toObject() as unknown as Record<string, unknown>;
    return {
      ...obj,
      label: describeEvent(entry.event),
      target: { type: entry.entityType, id: entry.entityId.toString() },
      actor: await this.resolveActorSummary(entry.actor),
    };
  }

  private async resolveActorSummary(actor: string): Promise<ActorSummary> {
    if (actor === 'system' || !isValidObjectId(actor)) {
      return { id: actor, name: capitalize(actor), role: 'System' };
    }
    const user = await this.usersService.findById(actor);
    if (user) {
      return { id: actor, name: user.name, role: 'User', image: user.image };
    }
    const admin = await this.adminAuthService.findById(actor);
    if (admin) {
      return { id: actor, name: admin.name, role: 'Admin' };
    }
    return { id: actor, name: 'Unknown', role: 'System' };
  }

  // Admin has no accountStatus/avgRating/company/listings — those fields
  // are simply omitted for an Admin actor rather than faked.
  private async resolveActorDetail(actor: string): Promise<ActorDetail> {
    if (actor === 'system' || !isValidObjectId(actor)) {
      return { id: actor, name: capitalize(actor), role: 'System' };
    }
    const user = await this.usersService.findById(actor);
    if (user) {
      const totalListings = await this.listingModel.countDocuments({
        seller: user._id,
      });
      return {
        id: actor,
        name: user.name,
        role: 'User',
        image: user.image,
        email: user.email,
        status: user.accountStatus,
        createdAt: user.createdAt,
        rating: user.avgRating,
        company: user.company,
        totalListings,
      };
    }
    const admin = await this.adminAuthService.findById(actor);
    if (admin) {
      return {
        id: actor,
        name: admin.name,
        role: 'Admin',
        email: admin.email,
        createdAt: admin.createdAt,
      };
    }
    return { id: actor, name: 'Unknown', role: 'System' };
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
