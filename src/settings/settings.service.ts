import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AppSettings,
  AppSettingsDocument,
} from './schemas/app-settings.schema';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto';
import { UpdatePaymentSettingsDto } from './dto/update-payment-settings.dto';
import { UpdateFeesSettingsDto } from './dto/update-fees-settings.dto';

// Fields retired from the AppSettings schema that may still be sitting on
// an already-existing singleton document — Mongoose doesn't strip fields it
// no longer declares, it just stops managing them, so a document created
// before a removal keeps returning the old field forever unless something
// actively unsets it. $unset-ing a field that isn't there is a harmless
// no-op, so this rides along on every read/write below rather than needing
// a one-off migration script. Must go through the raw collection, not the
// Mongoose model — with the default `strict: true` schema option,
// Mongoose's update-casting silently drops $unset/$set paths that aren't
// declared on the schema, so a model-level findOneAndUpdate($unset: ...)
// for a field the schema no longer has is a guaranteed silent no-op.
const RETIRED_FIELDS = {
  defaultSearchRadiusKm: 1,
  offerExpiryDays: 1,
  walletBalanceEnabled: 1,
  // Replaced by the nested inspectionWindow object, 2026-08-28.
  escrowStalledThresholdDays: 1,
} as const;

@Injectable()
export class SettingsService {
  private cached: AppSettingsDocument | null = null;

  constructor(
    @InjectModel(AppSettings.name)
    private appSettingsModel: Model<AppSettingsDocument>,
  ) {}

  async get(): Promise<AppSettingsDocument> {
    if (this.cached) {
      return this.cached;
    }
    await this.appSettingsModel.collection.updateOne(
      {},
      { $unset: RETIRED_FIELDS },
    );
    const doc = await this.appSettingsModel.findOneAndUpdate(
      {},
      {},
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.cached = doc;
    return doc;
  }

  // Category-scoped update endpoints the admin settings page calls
  async updateGeneral(
    dto: UpdateGeneralSettingsDto,
  ): Promise<AppSettingsDocument> {
    return this.applyUpdate(dto);
  }

  async updatePayments(
    dto: UpdatePaymentSettingsDto,
  ): Promise<AppSettingsDocument> {
    return this.applyUpdate(dto);
  }

  async updateFees(dto: UpdateFeesSettingsDto): Promise<AppSettingsDocument> {
    return this.applyUpdate(dto);
  }

  private async applyUpdate(
    dto:
      | UpdateGeneralSettingsDto
      | UpdatePaymentSettingsDto
      | UpdateFeesSettingsDto,
  ): Promise<AppSettingsDocument> {
    await this.appSettingsModel.collection.updateOne(
      {},
      { $unset: RETIRED_FIELDS },
    );
    const doc = await this.appSettingsModel.findOneAndUpdate(
      {},
      { $set: dto },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.cached = doc;
    return doc;
  }
}
