import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type BankAccountDocument = HydratedDocument<BankAccount>;

// One per user — payout destination for a seller. shortName/fullName both come from
// Paystack's bank-list `name` field (Paystack has no separate short/full name) but are
// kept as two fields to match the confirmed response shape rather than collapsing to one.
@Schema({ timestamps: true })
export class BankAccount {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  user: Types.ObjectId;

  @Prop({ required: true })
  bankCode: string;

  @Prop({ required: true })
  shortName: string;

  @Prop({ required: true })
  fullName: string;

  @Prop({ required: true })
  accountNumber: string;

  // Computed server-side — "•••• " + last 4 digits, never client-supplied.
  @Prop({ required: true })
  maskedAccountNumber: string;

  // Resolved fresh from Paystack on every create/update — never trusted from the client, since it gates where a future payout lands.
  @Prop({ required: true })
  accountHolderName: string;

  createdAt: Date;
  updatedAt: Date;
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);
