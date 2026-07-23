import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AppSettings,
  AppSettingsDocument,
} from './schemas/app-settings.schema';
import { UpdateAppSettingsDto } from './dto/update-app-settings.dto';

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
    const doc = await this.appSettingsModel.findOneAndUpdate(
      {},
      {},
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.cached = doc;
    return doc;
  }

  async update(dto: UpdateAppSettingsDto): Promise<AppSettingsDocument> {
    const doc = await this.appSettingsModel.findOneAndUpdate(
      {},
      { $set: dto },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.cached = doc;
    return doc;
  }
}
