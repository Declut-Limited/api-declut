import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type TransactionNoteDocument = HydratedDocument<TransactionNote>;

// Admin-only internal notes on a transaction — never shown to the buyer/seller,
// only on the admin detail view (GET /admin/transactions/:idOrSlug). No
// updatedAt — a note is never edited after creation, only ever added.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class TransactionNote {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
    index: true,
  })
  transaction: Types.ObjectId;

  // The admin who wrote it — always taken from the caller's own token, never client-supplied.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Admin',
    required: true,
  })
  writtenBy: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  description: string;

  createdAt: Date;
}

export const TransactionNoteSchema =
  SchemaFactory.createForClass(TransactionNote);
