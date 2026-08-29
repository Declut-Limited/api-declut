import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  Category,
  CategoryDocument,
  CategoryStatus,
} from './schemas/category.schema';
import { Listing, ListingDocument } from '../listings/schemas/listing.schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ListCategoriesDto } from './dto/list-categories.dto';
import { slugify } from '../common/utils/slugify.util';
import { toCsv } from '../common/utils/csv.util';
import { buildDateRangeFilter } from '../common/utils/date-range.util';
import { DateRangeDto } from '../common/dto/date-range.dto';

export interface CategoryWithCount {
  id: string;
  title: string;
  slug: string;
  status: CategoryStatus;
  listingCount: number;
  createdAt: Date;
}

export interface PublicCategory {
  id: string;
  title: string;
  slug: string;
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    // Only for the listingCount aggregation below — injected directly
    // rather than via ListingsService to avoid a circular module import
    // (ListingsModule already depends on CategoriesModule to validate a
    // listing's category), same pattern TrustScoreService uses.
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
  ) {}

  async create(
    adminId: string,
    dto: CreateCategoryDto,
  ): Promise<CategoryWithCount> {
    const slug = slugify(dto.title);
    const existing = await this.categoryModel.findOne({ slug });
    if (existing) {
      throw new ConflictException('A category with this title already exists');
    }

    const category = await this.categoryModel.create({
      title: dto.title,
      slug,
      status: dto.status ?? CategoryStatus.ACTIVE,
      createdBy: adminId,
    });

    return this.withCount(category);
  }

  async list(dto: ListCategoriesDto = {}): Promise<{
    results: CategoryWithCount[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter = buildDateRangeFilter(dto);
    const [categories, total] = await Promise.all([
      this.categoryModel
        .find(filter)
        .sort({ title: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.categoryModel.countDocuments(filter),
    ]);
    const results = await this.withCounts(categories);
    return { results, total, page, limit };
  }

  // Public, unauthenticated browse endpoint — active categories only, lean shape.
  async listPublic(): Promise<PublicCategory[]> {
    const categories = await this.categoryModel
      .find({ status: CategoryStatus.ACTIVE })
      .sort({ title: 1 })
      .exec();
    return categories.map((c) => ({
      id: c._id.toString(),
      title: c.title,
      slug: c.slug,
    }));
  }

  async toggleStatus(id: string): Promise<CategoryWithCount> {
    const category = await this.findByIdOrThrow(id);
    category.status =
      category.status === CategoryStatus.ACTIVE
        ? CategoryStatus.HIDDEN
        : CategoryStatus.ACTIVE;
    await category.save();
    return this.withCount(category);
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryWithCount> {
    const category = await this.findByIdOrThrow(id);

    if (dto.title !== undefined && dto.title !== category.title) {
      const slug = slugify(dto.title);
      const clash = await this.categoryModel.findOne({
        slug,
        _id: { $ne: id },
      });
      if (clash) {
        throw new ConflictException(
          'A category with this title already exists',
        );
      }
      category.title = dto.title;
      category.slug = slug;
    }
    if (dto.status !== undefined) category.status = dto.status;

    await category.save();
    return this.withCount(category);
  }

  // Blocks deletion while any listing still references this category (same guard RolesService uses for a Role still assigned to an Admin).
  async remove(id: string): Promise<void> {
    const category = await this.findByIdOrThrow(id);
    const listingCount = await this.listingModel.countDocuments({
      category: category._id,
    });
    if (listingCount > 0) {
      throw new ConflictException(
        `${listingCount} listing${listingCount === 1 ? ' is' : 's are'} using this category — move or remove them before deleting it`,
      );
    }
    await category.deleteOne();
  }

  // Unpaginated (full matching set) — list() is now paginated, so this
  // queries directly rather than going through it, same as every other
  // export in this app.
  async exportCsv(dateRange: DateRangeDto = {}): Promise<string> {
    const categories = await this.categoryModel
      .find(buildDateRangeFilter(dateRange))
      .sort({ title: 1 })
      .exec();
    const withCounts = await this.withCounts(categories);
    return toCsv(withCounts as unknown as Record<string, unknown>[], [
      'id',
      'title',
      'slug',
      'status',
      'listingCount',
      'createdAt',
    ]);
  }

  // Existence check used by ListingsService when creating/updating a
  // listing — any existing category (active or hidden) is a valid
  // reference; hiding a category doesn't invalidate listings already on it.
  async findById(id: string): Promise<CategoryDocument> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid category');
    }
    const category = await this.categoryModel.findById(id).exec();
    if (!category) {
      throw new BadRequestException('Category not found');
    }
    return category;
  }

  private async findByIdOrThrow(id: string): Promise<CategoryDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Category not found');
    }
    const category = await this.categoryModel.findById(id).exec();
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  private async withCount(
    category: CategoryDocument,
  ): Promise<CategoryWithCount> {
    const [result] = await this.withCounts([category]);
    return result;
  }

  private async withCounts(
    categories: CategoryDocument[],
  ): Promise<CategoryWithCount[]> {
    const counts = await this.listingModel.aggregate<{
      _id: unknown;
      count: number;
    }>([
      { $match: { category: { $in: categories.map((c) => c._id) } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    return categories.map((c) => ({
      id: c._id.toString(),
      title: c.title,
      slug: c.slug,
      status: c.status,
      listingCount: countMap.get(c._id.toString()) ?? 0,
      createdAt: c.createdAt,
    }));
  }
}
