import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

// The entityType values actually in use across every AuditLogService.record()
// call site, as of this writing — kept here for query-param validation
// (ListActivityLogDto) only. The schema field itself stays a plain string,
// not an enum, so a future module can start writing a new entityType
// without a schema migration; this list just needs a new member alongside it.
export enum AuditEntityType {
  TRANSACTION = 'transaction',
  LISTING = 'listing',
  REVIEW = 'review',
  REPORT = 'report',
  ARTICLE = 'article',
  CAMPAIGN = 'campaign',
}

// Append-only, cross-domain — one row per notable event on any entity
// (transaction, listing, report, ...). entityId has no ref: it points at a
// different collection depending on entityType, and every reader already
// knows its own entityType when it queries, so it doesn't need populate().
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ required: true, index: true })
  entityType: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  entityId: Types.ObjectId;

  @Prop({ required: true })
  event: string;

  // 'system' for non-human-triggered events; an actor id string otherwise.
  @Prop({ required: true })
  actor: string;

  @Prop()
  oldState?: string;

  @Prop()
  newState?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  // Captured automatically by AuditLogService from the request-scoped
  // context AuditContextMiddleware sets up — never passed explicitly by
  // callers. See audit-log-context.ts.
  @Prop()
  ipAddress?: string;

  createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
