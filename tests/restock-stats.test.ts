import { describe, expect, it } from 'vitest';
import { buildForecast, buildRestockStats, parseRestockFilters, dropStarts, median, weekdayOf, type VariantRestock } from '../src/stock/restock.stats.js';

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


describe('restock filters', () => {
  it('parses weekdays and validates inclusive date ranges', () => {
    expect(parseRestockFilters(new URLSearchParams('weekday=2&from=2026-11-01&to=2026-11-08'))).toEqual({ weekday: 2, from: '2026-11-01', to: '2026-11-08' });
    for (const input of ['weekday=7', 'weekday=-1', 'weekday=2x', 'from=2026-02-30&to=2026-03-01', 'from=2026-11-08&to=2026-11-01', 'from=2026-11-01']) {
      expect(() => parseRestockFilters(new URLSearchParams(input))).toThrow();
    }
  });
  it('filters all aggregates and recent events by weekday AND inclusive Bangkok dates', () => {
    const events = [
      ev('2026-11-03T16:59:00Z'),
      ev('2026-11-03T17:00:00Z'),
      ev('2026-11-04T16:59:59Z'),
      ev('2026-11-04T17:00:00Z'),
      ev('2026-11-10T17:00:00Z'),
    ];
    const stats = buildRestockStats(events, 30, new Date('2026-11-15T00:00:00Z'), { weekday: 2, from: '2026-11-04', to: '2026-11-04' });
    expect(stats.totals.events).toBe(2);
    expect(stats.recent).toHaveLength(2);
    expect(stats.byDay).toEqual([{ date: '2026-11-04', count: 2 }]);
    expect(stats.byWeekday).toEqual([0, 0, 2, 0, 0, 0, 0]);
    expect(stats.byHour[0]).toBe(1);
    expect(stats.byHour[23]).toBe(1);
    expect(stats.byStore.reduce((n, s) => n + s.count, 0)).toBe(2);
    expect(stats.byVariant.reduce((n, s) => n + s.count, 0)).toBe(2);
  });
  it('returns empty aggregates for no matching weekday', () => {
    const stats = buildRestockStats([ev('2026-11-04T05:00:00Z')], 30, new Date('2026-11-08T00:00:00Z'), { weekday: 3 });
    expect(stats.totals.events).toBe(0);
    expect(stats.totals.lastAt).toBeNull();
    expect(stats.recent).toEqual([]);
    expect(stats.byDay.every((d) => new Date(d.date + 'T12:00:00+07:00').getUTCDay() === 4)).toBe(true);
  });
});

describe('recent restock date chips and pagination', () => {
  const now = new Date('2026-11-15T05:00:00Z');
  it('lists every matching calendar date beyond the 90-day chart window', () => {
    const stats = buildRestockStats([], 180, now, { weekday: 0 });
    expect(stats.recentDates.length).toBeGreaterThan(20);
    expect(stats.recentDates.every((item) => weekdayOf(new Date(item.date + 'T12:00:00+07:00')) === 0)).toBe(true);
    expect(stats.recentDates.every((item) => item.count === 0)).toBe(true);
    expect(stats.recentDates[0]!.date > stats.recentDates.at(-1)!.date).toBe(true);
    expect(stats.recentDates.at(-1)!.date < stats.byDay[0]!.date).toBe(true);
  });
  it('uses date chips only for the selected inclusive range and weekday', () => {
    const stats = buildRestockStats([ev('2026-11-02T05:00:00Z'), ev('2026-11-09T05:00:00Z')], 30, now, { weekday: 0, from: '2026-11-01', to: '2026-11-10' });
    expect(stats.recentDates).toEqual([{ date: '2026-11-09', count: 1 }, { date: '2026-11-02', count: 1 }]);
  });
  it('exposes every matching row across pages rather than stopping at 20 or 60', () => {
    const events = Array.from({ length: 85 }, (_, i) => ev(new Date(Date.parse('2026-11-09T00:00:00Z') + i * 60_000).toISOString()));
    const seen: string[] = [];
    for (let page = 0; page < 5; page++) {
      const stats = buildRestockStats(events, 30, now, { weekday: 0, recentDate: '2026-11-09', page });
      expect(stats.recentPagination).toMatchObject({ page, pages: 5, total: 85, pageSize: 20 });
      seen.push(...stats.recent.map((row) => row.at));
    }
    expect(seen).toHaveLength(85);
    expect(new Set(seen).size).toBe(85);
    expect(seen).toEqual(events.map((e) => e.at.toISOString()).reverse());
  });
  it('keeps summary and chips unchanged when selecting a date and clamps stale pages', () => {
    const events = [ev('2026-11-02T05:00:00Z'), ev('2026-11-09T05:00:00Z')];
    const all = buildRestockStats(events, 30, now, { weekday: 0 });
    const one = buildRestockStats(events, 30, now, { weekday: 0, recentDate: '2026-11-02', page: 100 });
    expect(one.recentDates).toEqual(all.recentDates);
    expect(one.totals).toEqual(all.totals);
    expect(one.recentPagination).toMatchObject({ page: 0, total: 1, pages: 1 });
    expect(one.recent).toHaveLength(1);
    expect(one.recent[0]!.at).toBe('2026-11-02T05:00:00.000Z');
    const empty = buildRestockStats(events, 30, now, { weekday: 0, recentDate: '2026-11-03' });
    expect(empty.recent).toEqual([]);
    expect(empty.recentPagination.total).toBe(0);
  });
  it('validates recent-date and page query parameters', () => {
    expect(parseRestockFilters(new URLSearchParams('recentDate=2026-11-09&page=4'))).toEqual({ recentDate: '2026-11-09', page: 4 });
    for (const value of ['page=-1', 'page=abc', 'page=1.5', 'page=999999999999999999', 'recentDate=2026-02-30']) {
      expect(() => parseRestockFilters(new URLSearchParams(value))).toThrow();
    }
  });
});

describe('multiple recent dates', () => {
  it('validates and deduplicates selected date parameters', () => {
    expect(parseRestockFilters(new URLSearchParams('recentDates=2026-11-02&recentDates=2026-11-09&recentDates=2026-11-02'))).toEqual({ recentDates: ['2026-11-02', '2026-11-09'] });
    expect(() => parseRestockFilters(new URLSearchParams('recentDates=2026-11-02&recentDates=2026-02-30'))).toThrow();
  });
  it('paginates the union of selected dates without duplicates or changing summary totals', () => {
    const events = Array.from({ length: 25 }, (_, i) => ev(new Date(Date.parse('2026-11-02T01:00:00Z') + i * 60_000).toISOString()));
    events.push(ev('2026-11-09T05:00:00Z'), ev('2026-11-10T05:00:00Z'));
    const now = new Date('2026-11-15T05:00:00Z');
    const filters = { recentDates: ['2026-11-02', '2026-11-09', '2026-11-02'] };
    const first = buildRestockStats(events, 30, now, filters);
    const second = buildRestockStats(events, 30, now, { ...filters, page: 1 });
    expect(first.recentPagination.total).toBe(26);
    expect(first.recent).toHaveLength(20);
    expect(second.recent).toHaveLength(6);
    expect(first.totals.events).toBe(27);
    expect(first.recent[0]!.at).toBe('2026-11-09T05:00:00.000Z');
    expect(new Set([...first.recent, ...second.recent].map((e) => e.at)).size).toBe(26);
    expect(buildRestockStats(events, 30, now, { recentDates: [] }).recentPagination.total).toBe(27);
  });
});
