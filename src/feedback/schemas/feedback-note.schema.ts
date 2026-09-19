import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type FeedbackNoteDocument = HydratedDocument<FeedbackNote>;

// Admin-only internal notes on a feedback item — never shown to the
// submitting user, only on the admin detail view. Mirrors TransactionNote's
// exact shape.
@Schema({ timestamps: true })
export class FeedbackNote {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Feedback',
    required: true,
    index: true,
  })
  feedback: Types.ObjectId;

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
  updatedAt: Date;
}

export const FeedbackNoteSchema = SchemaFactory.createForClass(FeedbackNote);
