import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Feedback, FeedbackDocument } from './schemas/feedback.schema';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback.name) private feedbackModel: Model<FeedbackDocument>,
  ) {}

  async create(
    userId: string,
    dto: CreateFeedbackDto,
  ): Promise<FeedbackDocument> {
    return this.feedbackModel.create({
      user: userId,
      category: dto.category,
      feedbackDescription: dto.feedbackDescription,
      canContactMe: dto.canContactMe ?? false,
      screenshot: dto.screenshot,
      experience: dto.experience,
    });
  }

  async listForUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    results: FeedbackDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter = { user: new Types.ObjectId(userId) };
    const [results, total] = await Promise.all([
      this.feedbackModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.feedbackModel.countDocuments(filter),
    ]);
    return { results, total, page, limit };
  }
}
