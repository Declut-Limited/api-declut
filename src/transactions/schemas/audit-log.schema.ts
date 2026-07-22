import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/**
 * One row per money-movement event, per CLAUDE.md's Security Requirements —
 * this is what makes disputes resolvable later. Append-only: nothing in
 * this module ever updates or deletes an AuditLog document.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Transaction', required: true, index: true })
  transaction: Types.ObjectId;

  @Prop({ required: true })
  event: string;

  // 'system' for the webhook/scheduler-triggered transitions that have no
  // human actor (payment verified, stalled sweep); a User id otherwise.
  @Prop({ required: true })
  actor: string;

  @Prop({ required: true })
  oldState: string;

  @Prop({ required: true })
  newState: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
