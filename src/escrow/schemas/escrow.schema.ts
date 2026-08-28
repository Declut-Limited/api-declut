import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type EscrowDocument = HydratedDocument<Escrow>;

export enum EscrowStatus {
  HELD = 'held',
  REFUNDED = 'refunded',
  RELEASED = 'released',
  FROZEN = 'frozen',
}

// A standalone collection, not a sub-document on Transaction — a Transaction
// is the checkout/payment record; an Escrow is created from it once payment
// is verified (one Escrow per Transaction) and represents the money
// actually being held. buyer/seller/listing are denormalized copies of the
// parent Transaction's own fields, set once at creation, so the escrow list
// admin view never has to reach through transaction for its own columns.
@Schema({ timestamps: true })
export class Escrow {
  // ESC-#### — assigned once, at creation, via CounterService.
  @Prop({ unique: true, sparse: true })
  slug?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
    unique: true,
    index: true,
  })
  transaction: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Listing', required: true })
  listing: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  buyer: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  seller: Types.ObjectId;

  // Amount paid — snapshot of Transaction.amount at the moment escrow was created.
  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ type: String, enum: EscrowStatus, default: EscrowStatus.HELD })
  status: EscrowStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const EscrowSchema = SchemaFactory.createForClass(Escrow);
