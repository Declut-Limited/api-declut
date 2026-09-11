import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  NotificationSetting,
  NotificationSettingDocument,
} from './schemas/notification-setting.schema';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';

@Injectable()
export class NotificationSettingsService {
  constructor(
    @InjectModel(NotificationSetting.name)
    private notificationSettingModel: Model<NotificationSettingDocument>,
  ) {}

  // Auto-creates on first call — every user gets a preferences document
  // lazily rather than needing a separate create step, same "first read
  // transparently creates the row with defaults" pattern AppSettings uses.
  async getForUser(
    requesterId: string,
    userId: string,
  ): Promise<Record<string, unknown>> {
    this.assertOwnership(requesterId, userId);
    const doc = await this.notificationSettingModel.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: new Types.ObjectId(userId) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return this.shape(doc);
  }

  async updateForUser(
    requesterId: string,
    userId: string,
    dto: UpdateNotificationSettingDto,
  ): Promise<Record<string, unknown>> {
    this.assertOwnership(requesterId, userId);

    const setFields: Record<string, boolean> = {};
    if (dto.channels?.push !== undefined) {
      setFields['channels.push'] = dto.channels.push;
    }
    if (dto.channels?.email !== undefined) {
      setFields['channels.email'] = dto.channels.email;
    }
    // paymentAndEscrowUpdates/listingActivity/productUpdates/referralAndRewards
    // are deliberately excluded — required, not user-toggleable, and not on
    // the DTO at all (forbidNonWhitelisted 400s a client that tries anyway).
    const fields = [
      'transactionUpdates',
      'inspectionReminders',
      'disputeUpdates',
    ] as const;
    for (const field of fields) {
      if (dto[field] !== undefined) {
        setFields[field] = dto[field] as boolean;
      }
    }

    const doc = await this.notificationSettingModel.findOneAndUpdate(
      { user: userId },
      { $set: setFields, $setOnInsert: { user: new Types.ObjectId(userId) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return this.shape(doc);
  }

  // Internal, system-facing lookup for NotificationsService's channel gating —
  // no ownership check, no upsert (a notification send shouldn't create a
  // settings row as a side effect). Returns null if the user has never had
  // one created; the caller applies the schema's own defaults in that case.
  async getRawForUser(
    userId: string,
  ): Promise<NotificationSettingDocument | null> {
    return this.notificationSettingModel.findOne({ user: userId });
  }

  private assertOwnership(requesterId: string, userId: string): void {
    if (requesterId !== userId) {
      throw new ForbiddenException(
        'You can only view or update your own notification settings',
      );
    }
  }

  private shape(doc: NotificationSettingDocument): Record<string, unknown> {
    const obj = doc.toObject() as unknown as Record<string, unknown>;
    const { _id, __v, user, ...rest } = obj;
    void __v;
    return {
      id: (_id as Types.ObjectId).toString(),
      userId: (user as Types.ObjectId).toString(),
      ...rest,
    };
  }
}
