import { env, type AppleProductTarget } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { appleClient, type AppleClient } from './apple.client.js';
import { parseCatalog, storageRank } from './apple.parser.js';
import { seedVariantsFor } from './apple.seed.js';
import { isRateLimitError, type AppleVariant } from './apple.types.js';

/**
 * Discovers the tracked variants (part numbers) from Apple's own buy-flow page
 * of every monitored model instead of hard-coding them, so a lineup change is
 * picked up automatically. Cached for APPLE_CATALOG_TTL_MINUTES - part numbers
 * change far less often than availability does.
 *
 * Each model is independent: if one buy page fails to parse, that model keeps
 * its previous catalogue (or seed) and the others carry on.
 */
export class AppleCatalog {
  private variants: AppleVariant[] = [];
  private readonly byModel = new Map<string, AppleVariant[]>();
  private loadedAt: number | null = null;
  private inflight: Promise<AppleVariant[]> | null = null;

  constructor(
    private readonly client: AppleClient = appleClient,
    private readonly products: () => readonly AppleProductTarget[] = () => env.appleProducts,
  ) {}

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

  /// Loads one model. Returns false when it had to fall back (old / seed / none).
  private async refreshProduct(product: AppleProductTarget): Promise<boolean> {
    let variants: AppleVariant[] = [];
    try {
      const html = await this.client.getProductPageHtml(product.url);
      variants = parseCatalog(html, product.model);
    } catch (error) {
      // Apple pushing back must still reach the rate-limit guard.
      if (isRateLimitError(error)) throw error;
      logger.warn('Apple buy page fetch failed', `${product.model}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (variants.length > 0) {
      this.byModel.set(product.model, variants);
      logger.info(
        `Catalogue loaded: ${product.model} ${variants.length} variants`,
        `colors=${[...new Set(variants.map((v) => v.color))].join('/')} storage=${[...new Set(variants.map((v) => v.storage))].join('/')}`,
      );
      return true;
    }

    // Keep the previous catalogue rather than blanking the monitor.
    logger.error(
      'Apple catalogue parse returned 0 variants - keeping previous catalogue',
      `model="${product.model}" url=${product.url}`,
    );
    if (!this.byModel.has(product.model)) {
      const seed = seedVariantsFor(product.model);
      if (seed.length > 0) {
        logger.warn(`Using ${seed.length} seeded part numbers for "${product.model}"`);
        this.byModel.set(product.model, seed);
      }
    }
    return false;
  }

  private async refresh(): Promise<AppleVariant[]> {
    const products = this.products();
    let allFresh = true;
    for (const product of products) {
      if (!(await this.refreshProduct(product))) allFresh = false;
    }

    const variants = products
      .flatMap((product) => this.byModel.get(product.model) ?? [])
      .sort(
        (a, b) =>
          products.findIndex((p) => p.model === a.model) - products.findIndex((p) => p.model === b.model) ||
          storageRank(a.storage) - storageRank(b.storage) ||
          a.color.localeCompare(b.color),
      );

    if (variants.length === 0) {
      throw new Error(
        `No variants found for ${products.map((p) => `"${p.model}" on ${p.url}`).join(', ')}`,
      );
    }

    this.variants = variants;
    // Short TTL when anything fell back: retry the live page soon, not in 24h.
    this.loadedAt = allFresh
      ? Date.now()
      : Date.now() - env.APPLE_CATALOG_TTL_MINUTES * 60_000 + 5 * 60_000;
    return this.variants;
  }
}

export const appleCatalog = new AppleCatalog();
