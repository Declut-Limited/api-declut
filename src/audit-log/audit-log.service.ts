import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { getAuditIpAddress } from './audit-log-context';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
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
    await this.auditLogModel.create({
      ...params,
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
}
