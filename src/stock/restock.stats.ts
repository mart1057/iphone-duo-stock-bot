import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma as defaultPrisma } from '../database/prisma.js';
import { dateKey, hourOfDay } from '../utils/datetime.js';
import { pairRestocks, type HistoryRow, type SkuOption } from './restock.history.js';

const DAY_MS = 86_400_000;
const TZ = process.env.TZ ?? 'Asia/Bangkok';
/// Several stores restocking within this window count as one "drop".
export const DROP_WINDOW_MS = 60 * 60 * 1000;

export interface VariantRestock {
  variantId: string;
  model: string;
  color: string;
  colorTh: string;
  storage: string;
  storeName: string;
  at: Date;
  soldOutAt: Date | null;
  stillAvailable: boolean;
}

/// 0 = Monday ... 6 = Sunday, in the bot's timezone.
export const weekdayOf = (date: Date): number => {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(short);
};

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const mode = (values: readonly number[]): { value: number; count: number } | null => {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return top ? { value: top[0], count: top[1] } : null;
};

/// Start times of drops: events closer than DROP_WINDOW_MS to the drop start merge.
export const dropStarts = (times: readonly Date[]): Date[] => {
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
  const starts: Date[] = [];
  for (const time of sorted) {
    const last = starts[starts.length - 1];
    if (!last || time.getTime() - last.getTime() > DROP_WINDOW_MS) starts.push(time);
  }
  return starts;
};

const inStockMs = (events: readonly VariantRestock[]): number[] =>
  events.filter((e) => e.soldOutAt).map((e) => e.soldOutAt!.getTime() - e.at.getTime());

// -- Statistics page ---------------------------------------------------------

export const buildRestockStats = (events: readonly VariantRestock[], days: number, now: Date = new Date()) => {
  const since = now.getTime() - days * DAY_MS;
  const inRange = events.filter((e) => e.at.getTime() >= since).sort((a, b) => b.at.getTime() - a.at.getTime());

  const byDay = new Map<string, number>();
  const chartDays = Math.min(days, 90);
  for (let i = chartDays - 1; i >= 0; i--) byDay.set(dateKey(new Date(now.getTime() - i * DAY_MS)), 0);
  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const byStore = new Map<string, number>();
  const byVariant = new Map<string, { model: string; color: string; colorTh: string; storage: string; count: number; lastAt: Date }>();

  for (const e of inRange) {
    const key = dateKey(e.at);
    if (byDay.has(key)) byDay.set(key, byDay.get(key)! + 1);
    byHour[hourOfDay(e.at)]!++;
    const weekday = weekdayOf(e.at);
    if (weekday >= 0) byWeekday[weekday]!++;
    byStore.set(e.storeName, (byStore.get(e.storeName) ?? 0) + 1);
    const v = byVariant.get(e.variantId) ?? { model: e.model, color: e.color, colorTh: e.colorTh, storage: e.storage, count: 0, lastAt: e.at };
    v.count++;
    if (e.at > v.lastAt) v.lastAt = e.at;
    byVariant.set(e.variantId, v);
  }

  const drops = [...new Set(inRange.map((e) => e.variantId))]
    .reduce((sum, id) => sum + dropStarts(inRange.filter((e) => e.variantId === id).map((e) => e.at)).length, 0);

  return {
    days,
    totals: {
      events: inRange.length,
      drops,
      variants: byVariant.size,
      stores: byStore.size,
      medianInStockMs: median(inStockMs(inRange)),
      lastAt: inRange[0]?.at.toISOString() ?? null,
    },
    byDay: [...byDay].map(([date, count]) => ({ date, count })),
    byHour,
    byWeekday,
    byStore: [...byStore].map(([store, count]) => ({ store, count })).sort((a, b) => b.count - a.count),
    byVariant: [...byVariant.values()]
      .sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime())
      .map((v) => ({ ...v, lastAt: v.lastAt.toISOString() })),
    recent: inRange.slice(0, 60).map((e) => ({
      model: e.model, colorTh: e.colorTh, storage: e.storage, storeName: e.storeName,
      at: e.at.toISOString(), soldOutAt: e.soldOutAt?.toISOString() ?? null, stillAvailable: e.stillAvailable,
    })),
  };
};

// -- Forecast page -----------------------------------------------------------

export interface ForecastInput {
  skus: readonly SkuOption[];
  events: readonly VariantRestock[];
  /// Days of history the estimate may use (retention, or less if the bot is new).
  observedDays: number;
  /// variantId -> how many chats are NOT muting it.
  watchers: ReadonlyMap<string, number>;
  /// variantIds currently in stock somewhere.
  inStock: ReadonlySet<string>;
  pausedModels: ReadonlySet<string>;
  now?: Date;
}

export const buildForecast = (input: ForecastInput) => {
  const now = input.now ?? new Date();
  const observedDays = Math.max(1, input.observedDays);
  return input.skus.map((sku) => {
    const events = input.events.filter((e) => e.variantId === sku.variantId);
    const drops = dropStarts(events.map((e) => e.at));
    const intervals = drops.slice(1).map((d, i) => d.getTime() - drops[i]!.getTime());
    const typicalInterval = median(intervals);
    const last = drops[drops.length - 1] ?? null;
    let nextAt: Date | null = null;
    if (last && typicalInterval !== null && drops.length >= 3) {
      nextAt = new Date(last.getTime() + typicalInterval);
      // Overdue: roll forward so the estimate is always in the future.
      while (nextAt.getTime() < now.getTime()) nextAt = new Date(nextAt.getTime() + typicalInterval);
    }
    const rate = drops.length / observedDays;
    const hour = drops.length >= 3 ? mode(drops.map(hourOfDay)) : null;
    const weekday = drops.length >= 3 ? mode(drops.map(weekdayOf)) : null;
    const confidence = drops.length >= 6 ? 'high' : drops.length >= 3 ? 'medium' : drops.length > 0 ? 'low' : 'none';
    return {
      variantId: sku.variantId,
      model: sku.model,
      color: sku.color,
      colorTh: sku.colorTh,
      storage: sku.storage,
      paused: input.pausedModels.has(sku.model),
      inStock: input.inStock.has(sku.variantId),
      watchers: input.watchers.get(sku.variantId) ?? 0,
      drops: drops.length,
      lastDropAt: last?.toISOString() ?? null,
      typicalIntervalMs: drops.length >= 3 ? typicalInterval : null,
      overdue: Boolean(last && typicalInterval !== null && drops.length >= 3 && last.getTime() + typicalInterval < now.getTime()),
      nextAt: nextAt?.toISOString() ?? null,
      /// Poisson estimate of at least one drop in the next 1 / 7 days.
      chance1d: 1 - Math.exp(-rate),
      chance7d: 1 - Math.exp(-rate * 7),
      typicalHour: hour?.value ?? null,
      typicalWeekday: weekday?.value ?? null,
      medianInStockMs: median(inStockMs(events)),
      confidence,
    };
  });
};

// -- Repository --------------------------------------------------------------

export class RestockStatsRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /// Every restock event of every variant since `since`, oldest rows first.
  async restocksSince(since: Date): Promise<VariantRestock[]> {
    const rows = await this.db.stockHistory.findMany({
      where: { status: { in: ['AVAILABLE', 'UNAVAILABLE'] }, checkedAt: { gte: since } },
      select: {
        stockId: true,
        status: true,
        checkedAt: true,
        stock: {
          select: {
            available: true,
            store: { select: { name: true } },
            variant: { select: { id: true, color: true, colorTh: true, storage: true, product: { select: { model: true } } } },
          },
        },
      },
      orderBy: { checkedAt: 'asc' },
      take: 100_000,
    });

    const groups = new Map<string, { rows: HistoryRow[]; meta: (typeof rows)[number]['stock']['variant'] }>();
    for (const row of rows) {
      const variant = row.stock.variant;
      const group = groups.get(variant.id) ?? { rows: [], meta: variant };
      group.rows.push({
        stockId: row.stockId,
        status: row.status,
        checkedAt: row.checkedAt,
        storeName: row.stock.store.name,
        currentlyAvailable: row.stock.available,
      });
      groups.set(variant.id, group);
    }

    const events: VariantRestock[] = [];
    for (const [variantId, group] of groups) {
      for (const event of pairRestocks(group.rows)) {
        events.push({
          variantId,
          model: group.meta.product.model,
          color: group.meta.color,
          colorTh: group.meta.colorTh ?? group.meta.color,
          storage: group.meta.storage,
          ...event,
        });
      }
    }
    return events;
  }

  /// Days of history available: the retention window, or less for a new bot.
  async observedDays(now = new Date()): Promise<number> {
    const first = await this.db.stock.aggregate({ _min: { firstSeenAt: true } });
    const since = first._min.firstSeenAt?.getTime() ?? now.getTime();
    return Math.min(env.RESTOCK_HISTORY_RETENTION_DAYS, Math.max(1, (now.getTime() - since) / DAY_MS));
  }

  async inStockVariantIds(): Promise<Set<string>> {
    const rows = await this.db.stock.findMany({ where: { available: true }, select: { variantId: true }, distinct: ['variantId'] });
    return new Set(rows.map((row) => row.variantId));
  }
}

export const restockStatsRepository = new RestockStatsRepository();
