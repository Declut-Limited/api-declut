import { Injectable, Logger } from '@nestjs/common';

export interface NigerianBankEntry {
  name: string;
  slug: string;
  code: string;
  logo: string;
}

// Public, unofficial dataset — used only to enrich Paystack's own bank list
// with a slug + logo; Paystack stays authoritative for which codes are
// valid/active (see PaystackService.listBanks()). Cached in-memory since a
// bank list barely changes and this third party has no uptime guarantee — a
// stale (or empty) cache is preferable to failing/slowing down every
// /banks or bank-account create/update call.
@Injectable()
export class NigerianBanksService {
  private readonly logger = new Logger(NigerianBanksService.name);
  private cache: Map<string, NigerianBankEntry> | null = null;
  private cachedAt = 0;
  private readonly ttlMs = 24 * 60 * 60 * 1000;

  async getByCode(code: string): Promise<NigerianBankEntry | undefined> {
    const map = await this.getMap();
    return map.get(code);
  }

  async getMap(): Promise<Map<string, NigerianBankEntry>> {
    if (this.cache && Date.now() - this.cachedAt < this.ttlMs) {
      return this.cache;
    }
    try {
      const response = await fetch('https://nigerianbanks.xyz/');
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      const banks = (await response.json()) as NigerianBankEntry[];
      this.cache = new Map(banks.map((b) => [b.code, b]));
      this.cachedAt = Date.now();
    } catch (err) {
      this.logger.warn(
        `Failed to fetch nigerianbanks.xyz — ${(err as Error).message}`,
      );
      // Keep serving a stale cache if we have one; otherwise fall back to
      // empty so callers just get bank data without a logo, not an error.
      if (!this.cache) {
        this.cache = new Map();
      }
    }
    return this.cache;
  }
}
