import {
  appleAvailabilityCollector,
  type AppleAvailabilityCollector,
} from '../apple/apple.availability.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { detectChange } from './stock.detector.js';
import { stockKey, stockRepository, type StockRepository } from './stock.repository.js';
import type { ProductStock, StockCheckResult, StockTransition } from './stock.types.js';

const describe = (stock: ProductStock): string =>
  `${stock.model} / ${stock.colorTh} (${stock.color}) / ${stock.storage} / ${stock.storeName}`;

export class StockService {
  constructor(
    private readonly collector: AppleAvailabilityCollector = appleAvailabilityCollector,
    private readonly repository: StockRepository = stockRepository,
  ) {}

  /**
   * One full monitoring cycle:
   *   collect -> upsert catalogue/stores -> compare against DB -> return edges.
   * Returns the transitions; sending is the notification layer's job.
   */
  async runCheck(): Promise<StockCheckResult> {
    const startedAt = new Date();
    logger.info('Stock check started');

    const firstRun = (await this.repository.countStocks()) === 0;
    if (firstRun) {
      logger.info('First run detected - baseline will be stored WITHOUT notifications');
    }

    const snapshot = await this.collector.collect();

    const productId = await this.repository.upsertProduct(env.APPLE_MODEL_FILTER);
    const variantIds = await this.repository.upsertVariants(productId, snapshot.variants);
    const storeIds = await this.repository.upsertStores(snapshot.stores);

    const transitions: StockTransition[] = [];
    const observedStockIds = new Set<string>();
    let available = 0;
    let unavailable = 0;
    let unknown = 0;

    for (const stock of snapshot.stocks) {
      const variantId = variantIds.get(stock.partNumber);
      const storeId = stock.storeCode ? storeIds.get(stock.storeCode) : undefined;

      if (!variantId || !storeId) {
        logger.warn('Skipping observation with unresolved ids', {
          part: stock.partNumber,
          store: stock.storeCode,
        });
        continue;
      }

      const { id: stockId, previous } = await this.repository.ensureStock(
        variantId,
        storeId,
        stock,
      );
      observedStockIds.add(stockId);

      const decision = detectChange(previous, stock);

      if (stock.status === 'AVAILABLE') available += 1;
      else if (stock.status === 'UNAVAILABLE') unavailable += 1;
      else unknown += 1;

      logger.debug(`Checked: ${describe(stock)}`, `-> ${stock.status} (${decision.reason})`);

      // ensureStock already wrote the baseline for a brand new row.
      if (previous !== null) {
        await this.repository.persist({
          stockId,
          status: decision.currentStatus,
          available: stock.available,
          updateAvailable: decision.shouldUpdateAvailable,
          recordHistory: decision.shouldRecordHistory,
          checkedAt: stock.checkedAt,
        });
      }

      if (decision.reason === 'became-available' || decision.reason === 'became-unavailable') {
        logger.info(
          `Status changed: ${decision.previousStatus} -> ${decision.currentStatus}`,
          describe(stock),
        );
      }

      if (decision.shouldNotify) {
        transitions.push({
          stockId,
          previousStatus: decision.previousStatus,
          currentStatus: decision.currentStatus,
          stock,
        });
      }
    }

    // Anything Apple did not answer for this cycle is UNKNOWN, not UNAVAILABLE.
    if (snapshot.errors.length > 0) {
      await this.markMissingAsUnknown(observedStockIds, snapshot.checkedAt);
    }

    const finishedAt = new Date();
    const result: StockCheckResult = {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      checked: snapshot.stocks.length,
      available,
      unavailable,
      unknown,
      transitions,
      firstRun,
      errors: snapshot.errors,
      rateLimited: snapshot.rateLimited,
    };

    logger.info(
      `Stock check finished in ${result.durationMs}ms`,
      `checked=${result.checked} available=${available} unavailable=${unavailable} unknown=${unknown} transitions=${transitions.length}`,
    );

    for (const error of snapshot.errors) logger.error('Apple request failed', error);

    return result;
  }

  private async markMissingAsUnknown(observed: ReadonlySet<string>, checkedAt: Date): Promise<void> {
    const states = await this.repository.loadPreviousStates();
    for (const row of states.values()) {
      if (observed.has(row.id)) continue;
      await this.repository.persist({
        stockId: row.id,
        status: 'UNKNOWN',
        available: row.available,
        updateAvailable: false,
        recordHistory: row.status !== 'UNKNOWN',
        checkedAt,
      });
    }
  }
}

export { stockKey };
export const stockService = new StockService();
