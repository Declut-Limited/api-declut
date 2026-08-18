import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Counter, CounterDocument } from './counter.schema';

@Injectable()
export class CounterService {
  constructor(
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
  ) {}

  async next(sequenceName: string): Promise<number> {
    const counter = await this.counterModel.findOneAndUpdate(
      { _id: sequenceName },
      { $inc: { value: 1 } },
      { upsert: true, new: true },
    );
    return counter.value;
  }

  // e.g. next('user', 'USR', 4) -> 'USR-0007'
  async nextSlug(
    sequenceName: string,
    prefix: string,
    padLength: number,
  ): Promise<string> {
    const value = await this.next(sequenceName);
    return `${prefix}-${String(value).padStart(padLength, '0')}`;
  }
}
