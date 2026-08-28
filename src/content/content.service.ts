import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  Content,
  ContentDocument,
  ContentStatus,
} from './schemas/content.schema';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ListContentDto } from './dto/list-content.dto';
import { CounterService } from '../common/counter/counter.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toCsv } from '../common/utils/csv.util';

// Admin has no `status` field of its own (unlike User's accountStatus), so that part of the populate ask is skipped.
const CREATED_BY_POPULATE = {
  path: 'createdBy',
  select: 'name email title createdAt role',
  populate: { path: 'role', select: 'name' },
};

@Injectable()
export class ContentService {
  constructor(
    @InjectModel(Content.name) private contentModel: Model<ContentDocument>,
    private readonly counterService: CounterService,
    private readonly auditLogService: AuditLogService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(
    adminId: string,
    dto: CreateContentDto,
  ): Promise<ContentDocument> {
    const slug = await this.counterService.nextSlug('content', 'CNT', 4);
    const content = await this.contentModel.create({
      title: dto.title,
      slug,
      contentType: dto.contentType,
      whereToAppear: dto.whereToAppear,
      contentBody: dto.contentBody,
      status: dto.status,
      createdBy: adminId,
    });

    await this.auditLogService.record({
      entityType: 'content',
      entityId: content._id.toString(),
      event: 'content.created',
      actor: adminId,
      newState: content.status,
    });

    if (content.status === ContentStatus.PUBLISHED) {
      await this.notificationsService.broadcastContentPublished(
        content,
        adminId,
      );
    }

    return content;
  }

  async list(dto: ListContentDto): Promise<{
    results: ContentDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter: Record<string, unknown> = {};
    if (dto.status) filter.status = dto.status;
    if (dto.contentType) filter.contentType = dto.contentType;

    const [results, total] = await Promise.all([
      this.contentModel
        .find(filter)
        .populate(CREATED_BY_POPULATE)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.contentModel.countDocuments(filter),
    ]);

    return { results, total, page, limit };
  }

  // Unpaginated (full matching set) and flattened, same convention as every other export in this app.
  async exportCsv(dto: ListContentDto): Promise<string> {
    const filter: Record<string, unknown> = {};
    if (dto.status) filter.status = dto.status;
    if (dto.contentType) filter.contentType = dto.contentType;

    const rows = await this.contentModel
      .find(filter)
      .populate({ path: 'createdBy', select: 'name email' })
      .sort({ createdAt: -1 })
      .exec();

    return toCsv(
      rows.map((r) => {
        const createdBy = r.createdBy as unknown as
          { name?: string; email?: string } | undefined;
        return {
          slug: r.slug,
          title: r.title,
          contentType: r.contentType,
          whereToAppear: r.whereToAppear,
          status: r.status,
          createdByName: createdBy?.name ?? '',
          createdByEmail: createdBy?.email ?? '',
          createdAt: (r as unknown as { createdAt: Date }).createdAt,
        };
      }),
      [
        'slug',
        'title',
        'contentType',
        'whereToAppear',
        'status',
        'createdByName',
        'createdByEmail',
        'createdAt',
      ],
    );
  }

  async findById(id: string): Promise<ContentDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Content not found');
    }
    const content = await this.contentModel
      .findById(id)
      .populate(CREATED_BY_POPULATE)
      .exec();
    if (!content) {
      throw new NotFoundException('Content not found');
    }
    return content;
  }

  async findBySlug(slug: string): Promise<ContentDocument> {
    const content = await this.contentModel
      .findOne({ slug })
      .populate(CREATED_BY_POPULATE)
      .exec();
    if (!content) {
      throw new NotFoundException('Content not found');
    }
    return content;
  }

  async update(
    id: string,
    adminId: string,
    dto: UpdateContentDto,
  ): Promise<ContentDocument> {
    const content = await this.findByIdOrThrow(id);
    const oldState = content.status;

    if (dto.title !== undefined) content.title = dto.title;
    if (dto.contentType !== undefined) content.contentType = dto.contentType;
    if (dto.whereToAppear !== undefined)
      content.whereToAppear = dto.whereToAppear;
    if (dto.contentBody !== undefined) content.contentBody = dto.contentBody;
    if (dto.status !== undefined) content.status = dto.status;

    await content.save();
    await content.populate(CREATED_BY_POPULATE);

    await this.auditLogService.record({
      entityType: 'content',
      entityId: id,
      event: 'content.updated',
      actor: adminId,
      oldState,
      newState: content.status,
    });

    if (content.status === ContentStatus.PUBLISHED) {
      await this.notificationsService.broadcastContentPublished(
        content,
        adminId,
      );
    }

    return content;
  }

  async remove(id: string, adminId: string): Promise<void> {
    const content = await this.findByIdOrThrow(id);
    await content.deleteOne();

    await this.auditLogService.record({
      entityType: 'content',
      entityId: id,
      event: 'content.deleted',
      actor: adminId,
      oldState: content.status,
    });
  }

  private async findByIdOrThrow(id: string): Promise<ContentDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Content not found');
    }
    const content = await this.contentModel.findById(id);
    if (!content) {
      throw new NotFoundException('Content not found');
    }
    return content;
  }
}
