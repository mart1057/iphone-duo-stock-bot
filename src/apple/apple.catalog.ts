import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { appleClient, type AppleClient } from './apple.client.js';
import { parseCatalog, storageRank } from './apple.parser.js';
import { seedVariantsFor } from './apple.seed.js';
import { isRateLimitError, type AppleVariant } from './apple.types.js';

/**
 * Discovers the tracked variants (part numbers) from Apple's own buy-flow page
 * instead of hard-coding them, so a lineup change is picked up automatically.
 * Cached for APPLE_CATALOG_TTL_MINUTES - part numbers change far less often
 * than availability does.
 */
export class AppleCatalog {
  private variants: AppleVariant[] = [];
  private loadedAt: number | null = null;
  private inflight: Promise<AppleVariant[]> | null = null;

  constructor(private readonly client: AppleClient = appleClient) {}

  private isStale(): boolean {
    if (this.loadedAt === null) return true;
    return Date.now() - this.loadedAt > env.APPLE_CATALOG_TTL_MINUTES * 60_000;
  }

  async getVariants(force = false): Promise<AppleVariant[]> {
    if (!force && !this.isStale() && this.variants.length > 0) return this.variants;
    // Collapse concurrent refreshes into a single fetch.
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  async getVariantMap(force = false): Promise<Map<string, AppleVariant>> {
    const variants = await this.getVariants(force);
    return new Map(variants.map((variant) => [variant.partNumber, variant]));
  }

  private async refresh(): Promise<AppleVariant[]> {
    let variants: AppleVariant[] = [];
    try {
      const html = await this.client.getProductPageHtml();
      variants = parseCatalog(html, env.APPLE_MODEL_FILTER);
    } catch (error) {
      // Apple pushing back must still reach the rate-limit guard.
      if (isRateLimitError(error)) throw error;
      logger.warn('Apple buy page fetch failed', error instanceof Error ? error.message : String(error));
    }

    if (variants.length === 0) {
      // Keep the previous catalogue rather than blanking the monitor.
      logger.error(
        'Apple catalogue parse returned 0 variants - keeping previous catalogue',
        `model="${env.APPLE_MODEL_FILTER}" url=${env.APPLE_PRODUCT_URL}`,
      );
      if (this.variants.length > 0) return this.variants;
      const seed = seedVariantsFor(env.APPLE_MODEL_FILTER);
      if (seed.length > 0) {
        logger.warn(`Using ${seed.length} seeded part numbers for "${env.APPLE_MODEL_FILTER}"`);
        // Short TTL on purpose: retry the live page soon instead of in 24h.
        this.variants = seed;
        this.loadedAt = Date.now() - env.APPLE_CATALOG_TTL_MINUTES * 60_000 + 5 * 60_000;
        return this.variants;
      }
      throw new Error(
        `No variants found for "${env.APPLE_MODEL_FILTER}" on ${env.APPLE_PRODUCT_URL}`,
      );
    }

    this.variants = variants.sort(
      (a, b) => storageRank(a.storage) - storageRank(b.storage) || a.color.localeCompare(b.color),
    );
    this.loadedAt = Date.now();

    logger.info(
      `Catalogue loaded: ${variants.length} variants`,
      `colors=${[...new Set(variants.map((v) => v.color))].join('/')} storage=${[...new Set(variants.map((v) => v.storage))].join('/')}`,
    );

    return this.variants;
  }
}

export const appleCatalog = new AppleCatalog();
