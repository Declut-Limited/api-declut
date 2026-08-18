import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

// One document per named sequence (e.g. 'user', 'listing', 'report') —
// value is atomically incremented via findOneAndUpdate, never read-then-write.
@Schema()
export class Counter {
  @Prop({ required: true })
  _id: string;

  @Prop({ default: 0 })
  value: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
