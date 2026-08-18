import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Report, ReportDocument, ReportStatus } from './schemas/report.schema';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { CounterService } from '../common/counter/counter.service';
import { AuditLogService } from '../audit-log/audit-log.service';

const POPULATE_FIELDS = {
  listing: 'title slug',
  user: 'name email',
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
    private readonly counterService: CounterService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(adminId: string, dto: CreateReportDto): Promise<ReportDocument> {
    if (!dto.listingId && !dto.userId) {
      throw new BadRequestException(
        'A report must reference a listing, a user, or both',
      );
    }

    const slug = await this.counterService.nextSlug('report', 'RPT', 4);
    const report = await this.reportModel.create({
      slug,
      title: dto.title,
      reason: dto.reason,
      listing: dto.listingId,
      user: dto.userId,
      createdBy: adminId,
    });

    await this.auditLogService.record({
      entityType: 'report',
      entityId: report._id.toString(),
      event: 'report.created',
      actor: adminId,
      newState: report.status,
    });

    return report;
  }

  async list(dto: ListReportsDto): Promise<{
    results: ReportDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const filter = dto.status ? { status: dto.status } : {};

    const [results, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .populate('listing', POPULATE_FIELDS.listing)
        .populate('user', POPULATE_FIELDS.user)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.reportModel.countDocuments(filter),
    ]);

    return { results, total, page, limit };
  }

  async findBySlug(slug: string): Promise<ReportDocument> {
    const report = await this.reportModel
      .findOne({ slug })
      .populate('listing', POPULATE_FIELDS.listing)
      .populate('user', POPULATE_FIELDS.user)
      .exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  async updateStatus(
    id: string,
    adminId: string,
    status: ReportStatus,
  ): Promise<ReportDocument> {
    const report = await this.reportModel.findById(id).exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    const oldState = report.status;
    report.status = status;
    await report.save();

    await this.auditLogService.record({
      entityType: 'report',
      entityId: id,
      event: 'report.status_updated',
      actor: adminId,
      oldState,
      newState: status,
    });

    return report;
  }
}
