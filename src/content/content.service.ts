import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  Article,
  ArticleDocument,
  ArticleStatus,
} from './schemas/article.schema';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { ListArticlesDto } from './dto/list-articles.dto';
import { slugify } from '../common/utils/slugify.util';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class ContentService {
  constructor(
    @InjectModel(Article.name) private articleModel: Model<ArticleDocument>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    adminId: string,
    dto: CreateArticleDto,
  ): Promise<ArticleDocument> {
    const slug = slugify(dto.title);
    const existing = await this.articleModel.findOne({ slug });
    if (existing) {
      throw new ConflictException('An article with this title already exists');
    }

    const article = await this.articleModel.create({
      title: dto.title,
      slug,
      body: dto.body,
      createdBy: adminId,
    });

    await this.auditLogService.record({
      entityType: 'article',
      entityId: article._id.toString(),
      event: 'article.created',
      actor: adminId,
      newState: article.status,
    });

    return article;
  }

  async list(dto: ListArticlesDto): Promise<{
    results: ArticleDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter = dto.status ? { status: dto.status } : {};

    const [results, total] = await Promise.all([
      this.articleModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.articleModel.countDocuments(filter),
    ]);

    return { results, total, page, limit };
  }

  async findBySlug(slug: string): Promise<ArticleDocument> {
    const article = await this.articleModel.findOne({ slug }).exec();
    if (!article) {
      throw new NotFoundException('Article not found');
    }
    return article;
  }

  async update(
    id: string,
    adminId: string,
    dto: UpdateArticleDto,
  ): Promise<ArticleDocument> {
    const article = await this.findByIdOrThrow(id);

    if (dto.title !== undefined && dto.title !== article.title) {
      const newSlug = slugify(dto.title);
      const clash = await this.articleModel.findOne({
        slug: newSlug,
        _id: { $ne: id },
      });
      if (clash) {
        throw new ConflictException(
          'An article with this title already exists',
        );
      }
      article.title = dto.title;
      article.slug = newSlug;
    }
    if (dto.body !== undefined) article.body = dto.body;

    await article.save();

    await this.auditLogService.record({
      entityType: 'article',
      entityId: id,
      event: 'article.updated',
      actor: adminId,
    });

    return article;
  }

  async publish(id: string, adminId: string): Promise<ArticleDocument> {
    const article = await this.findByIdOrThrow(id);
    const oldState = article.status;
    article.status = ArticleStatus.PUBLISHED;
    article.publishedAt = new Date();
    await article.save();

    await this.auditLogService.record({
      entityType: 'article',
      entityId: id,
      event: 'article.published',
      actor: adminId,
      oldState,
      newState: article.status,
    });

    return article;
  }

  async retire(id: string, adminId: string): Promise<ArticleDocument> {
    const article = await this.findByIdOrThrow(id);
    const oldState = article.status;
    article.status = ArticleStatus.RETIRED;
    await article.save();

    await this.auditLogService.record({
      entityType: 'article',
      entityId: id,
      event: 'article.retired',
      actor: adminId,
      oldState,
      newState: article.status,
    });

    return article;
  }

  async remove(id: string, adminId: string): Promise<void> {
    const article = await this.findByIdOrThrow(id);
    await article.deleteOne();

    await this.auditLogService.record({
      entityType: 'article',
      entityId: id,
      event: 'article.deleted',
      actor: adminId,
      oldState: article.status,
    });
  }

  private async findByIdOrThrow(id: string): Promise<ArticleDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Article not found');
    }
    const article = await this.articleModel.findById(id);
    if (!article) {
      throw new NotFoundException('Article not found');
    }
    return article;
  }
}
