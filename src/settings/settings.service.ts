import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AppSettings,
  AppSettingsDocument,
} from './schemas/app-settings.schema';
import { UpdateAppSettingsDto } from './dto/update-app-settings.dto';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto';
import { UpdatePaymentSettingsDto } from './dto/update-payment-settings.dto';
import { UpdateFeesSettingsDto } from './dto/update-fees-settings.dto';

// Fields retired from the AppSettings schema (2026-08-27) that may still be
// sitting on an already-existing singleton document — Mongoose doesn't
// strip fields it no longer declares, it just stops managing them, so a
// document created before this change keeps returning them forever unless
// something actively unsets them. $unset-ing a field that isn't there is a
// harmless no-op, so this rides along on every read/write below rather than
// needing a one-off migration script. Must go through the raw collection,
// not the Mongoose model — with the default `strict: true` schema option,
// Mongoose's update-casting silently drops $unset/$set paths that aren't
// declared on the schema, so a model-level findOneAndUpdate($unset: ...)
// for a field the schema no longer has is a guaranteed silent no-op.
const RETIRED_FIELDS = {
  defaultSearchRadiusKm: 1,
  offerExpiryDays: 1,
  walletBalanceEnabled: 1,
} as const;

/**
 * get() upserts against an empty filter — the first call from anywhere in
 * the app transparently creates the singleton row with schema defaults, no
 * separate seed step needed. Cached in-memory after the first read and
 * refreshed on update() — these values (commission %, offer expiry, etc.)
 * change rarely (an admin tuning config), so avoiding a DB round trip on
 * every checkout/search/offer/stalled-sweep read is worth a simple cache.
 * Caveat: the cache is per-process — a horizontally-scaled deployment would
 * need a TTL or pub/sub invalidation to stay in sync across instances, not
 * built here since this app isn't documented as running that way.
 */
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

  async update(dto: UpdateAppSettingsDto): Promise<AppSettingsDocument> {
    return this.applyUpdate(dto);
  }

  // Category-scoped update endpoints the admin settings page calls
  // (general, payments, fees; 1 more category TBD) — all patch the same
  // singleton document, just through a narrower per-category DTO.
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
      | UpdateAppSettingsDto
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
