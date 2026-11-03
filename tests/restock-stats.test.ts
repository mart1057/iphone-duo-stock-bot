import { describe, expect, it } from 'vitest';
import { buildForecast, buildRestockStats, dropStarts, median, weekdayOf, type VariantRestock } from '../src/stock/restock.stats.js';

const sku = { variantId: 'v1', model: 'iPhone Duo', color: 'Night Sky', colorTh: 'ไนท์สกาย', storage: '256GB', partNumber: 'P1' };
const ev = (iso: string, store = 'Apple Central World', soldMin: number | null = 30): VariantRestock => {
  const at = new Date(iso);
  return { ...sku, storeName: store, at, soldOutAt: soldMin === null ? null : new Date(at.getTime() + soldMin * 60_000), stillAvailable: false };
};

describe('restock stats', () => {
  it('merges stores restocking within an hour into one drop', () => {
    expect(dropStarts([new Date('2026-10-01T01:00:00Z'), new Date('2026-10-01T01:20:00Z'), new Date('2026-10-02T01:00:00Z')])).toHaveLength(2);
  });

  it('median and weekday', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(weekdayOf(new Date('2026-11-02T03:00:00Z'))).toBe(0); // Monday in Bangkok
  });

  it('aggregates by hour, store and variant within the window', () => {
    const now = new Date('2026-11-03T05:00:00Z');
    const stats = buildRestockStats([
      ev('2026-11-01T01:00:00Z'), ev('2026-11-01T01:10:00Z', 'Apple Iconsiam'), ev('2026-09-01T01:00:00Z'),
    ], 30, now);
    expect(stats.totals.events).toBe(2);
    expect(stats.totals.drops).toBe(1);
    expect(stats.byHour[8]).toBe(2); // 01:00Z = 08:00 Bangkok
    expect(stats.byStore).toHaveLength(2);
    expect(stats.totals.medianInStockMs).toBe(30 * 60_000);
    expect(stats.byDay).toHaveLength(30);
  });

  it('forecasts the next drop from the median interval and counts watchers', () => {
    const now = new Date('2026-11-03T05:00:00Z');
    const events = ['2026-10-27', '2026-10-29', '2026-10-31', '2026-11-02'].map((d) => ev(`${d}T01:00:00Z`));
    const [item] = buildForecast({
      skus: [sku], events, observedDays: 30, watchers: new Map([['v1', 4]]), inStock: new Set(), pausedModels: new Set(), now,
    });
    expect(item!.drops).toBe(4);
    expect(item!.typicalIntervalMs).toBe(2 * 86_400_000);
    expect(item!.nextAt).toBe('2026-11-04T01:00:00.000Z');
    expect(item!.overdue).toBe(false);
    expect(item!.typicalHour).toBe(8);
    expect(item!.watchers).toBe(4);
    expect(item!.confidence).toBe('medium');
    expect(item!.chance7d).toBeGreaterThan(0.5);
  });

  it('rolls an overdue estimate forward and needs 3 drops', () => {
    const now = new Date('2026-11-10T05:00:00Z');
    const three = ['2026-10-01', '2026-10-03', '2026-10-05'].map((d) => ev(`${d}T01:00:00Z`));
    const [late] = buildForecast({ skus: [sku], events: three, observedDays: 40, watchers: new Map(), inStock: new Set(), pausedModels: new Set(), now });
    expect(late!.overdue).toBe(true);
    expect(Date.parse(late!.nextAt!)).toBeGreaterThan(now.getTime());
    const [few] = buildForecast({ skus: [sku], events: three.slice(0, 2), observedDays: 40, watchers: new Map(), inStock: new Set(), pausedModels: new Set(), now });
    expect(few!.nextAt).toBeNull();
    expect(few!.confidence).toBe('low');
  });
});
