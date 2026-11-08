import { describe, expect, it, vi } from 'vitest';
import { bangkokDay, rangeDates, statisticsReport, statisticsHome } from '../src/notification/restock.statistics.js';
import { mainMenu } from '../src/notification/telegram.menus.js';
import { RestockHistoryRepository } from '../src/stock/restock.history.js';

const rows = [
  { day: '2026-11-04', hour: 9, count: 3 },
  { day: '2026-11-04', hour: 10, count: 1 },
  { day: '2026-10-28', hour: 9, count: 2 },
  { day: '2026-11-05', hour: 12, count: 10 },
];

describe('restock statistics', () => {
  it('groups all Wednesdays and ranks hour buckets using the filtered denominator', () => {
    const menu = statisticsReport(rows, 'weekday', '2026-10-01', '2026-11-08', 0, 3);
    expect(menu.text).toContain('ทุกวันพุธ');
    expect(menu.text).toContain('รวม 6 ครั้ง · พบใน 2 วัน');
    expect(menu.text).toContain('09:00–09:59 · 5 ครั้ง (83%)');
    expect(menu.text).not.toContain('12:00');
  });
  it('groups weeks Monday to Sunday across year boundaries', () => {
    const menu = statisticsReport([
      { day: '2026-12-31', hour: 8, count: 1 },
      { day: '2027-01-03', hour: 8, count: 2 },
      { day: '2027-01-04', hour: 8, count: 4 },
    ], 'week', '2026-12-01', '2027-01-05');
    expect(menu.text).toContain('28/12/2026–03/01/2027: 3 ครั้ง');
    expect(menu.text).toContain('04/01/2027–10/01/2027: 4 ครั้ง');
  });
  it('paginates daily entries without changing totals and clamps stale pages', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, hour: 9, count: 1 }));
    const menu = statisticsReport(many, 'day', '2026-10-01', '2026-11-01', 1);
    expect(menu.text).toContain('รวม 20 ครั้ง');
    expect(menu.keyboard.flat().map((b) => b.callback_data)).toContain('rsd:2');
    expect(menu.text.length).toBeLessThan(4096);
    expect(statisticsReport(many, 'day', '2026-10-01', '2026-11-01', Infinity).keyboard.flat().map((b) => b.callback_data)).toContain('rsd:1');
  });
  it('shows exact minutes beside dates in every report mode', () => {
    const events = [{ day: '2026-11-04', hour: 9, minute: 17, count: 2 }, { day: '2026-11-04', hour: 9, minute: 42, count: 1 }];
    for (const mode of ['day', 'week', 'weekday', 'range'] as const) {
      const menu = statisticsReport(events, mode, '2026-11-01', '2026-11-08', 0, 3);
      expect(menu.text).toContain('04/11/2026');
      expect(menu.text).toContain('วันพุธ 09:17 น. · 2 ครั้ง');
      expect(menu.text).toContain('วันพุธ 09:42 น. · 1 ครั้ง');
    }
  });
  it('paginates a busy day without losing times or exceeding Telegram limits', () => {
    const events = Array.from({ length: 1440 }, (_, i) => ({ day: '2026-11-04', hour: Math.floor(i / 60), minute: i % 60, count: 1 }));
    let rendered = 0;
    for (let page = 0; page < Math.ceil(events.length / 7); page++) {
      const menu = statisticsReport(events, 'day', '2026-11-04', '2026-11-04', page);
      expect(menu.text.length).toBeLessThan(4096);
      rendered += (menu.text.match(/น\. · 1 ครั้ง/g) ?? []).length;
    }
    expect(rendered).toBe(1440);
  });
  it('reports empty results without implying confirmed zero inventory', () => {
    expect(statisticsReport([], 'day', '2026-11-01', '2026-11-08').text).toContain('ยังไม่พบการเติมของ');
  });
  it('uses the Bangkok date across UTC midnight', () => {
    expect(bangkokDay(new Date('2026-11-03T17:01:00Z'))).toBe('2026-11-04');
  });
  it('rejects impossible and reversed custom dates', () => {
    expect(rangeDates('2026-02-30 2026-03-01')).toBeNull();
    expect(rangeDates('2026-11-08 2026-11-01')).toBeNull();
    expect(rangeDates('2026-11-01 2026-11-08')).toEqual({ from: '2026-11-01', to: '2026-11-08' });
  });
  it('hides the statistics menu from members', () => {
    expect(mainMenu('iPhone', false).keyboard.flat().map((b) => b.callback_data)).not.toContain('rs');
    expect(mainMenu('iPhone', true).keyboard.flat().map((b) => b.callback_data)).toContain('rs');
    expect(statisticsHome(180).text).toContain('180');
  });
  it('queries bounded AVAILABLE events, aggregates in Bangkok, and converts bigint counts', async () => {
    const query = vi.fn().mockResolvedValue([{ day: '2026-11-04', hour: 9, minute: 17, count: 3n }]);
    const repository = new RestockHistoryRepository({ $queryRaw: query } as never);
    const start = new Date('2026-11-01T00:00:00Z');
    const end = new Date('2026-11-08T00:00:00Z');
    expect(await repository.statistics(start, end)).toEqual([{ day: '2026-11-04', hour: 9, minute: 17, count: 3 }]);
    const [sql, from, to] = query.mock.calls[0]!;
    expect(sql.join('?')).toContain("status = 'AVAILABLE'");
    expect(sql.join('?')).toContain("AT TIME ZONE 'Asia/Bangkok'");
    expect(from).toBe(start);
    expect(to).toBe(end);
  });
});
