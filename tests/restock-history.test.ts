import { describe, expect, it } from 'vitest';
import {
  buildRestockHistoryText,
  formatDuration,
  periodLabel,
  pairRestocks,
  type HistoryRow,
} from '../src/stock/restock.history.js';

const at = (iso: string) => new Date(iso);
const row = (stockId: string, status: HistoryRow['status'], iso: string, storeName = 'Apple Central World', currentlyAvailable = false): HistoryRow =>
  ({ stockId, status, checkedAt: at(iso), storeName, currentlyAvailable });

describe('restock history', () => {
  it('pairs each restock with the next sold-out of the same stock, newest first', () => {
    const events = pairRestocks([
      row('a', 'AVAILABLE', '2026-10-25T02:00:00Z'),
      row('b', 'AVAILABLE', '2026-10-25T02:01:00Z', 'Apple Iconsiam', true),
      row('a', 'UNKNOWN', '2026-10-25T02:03:00Z'),
      row('a', 'UNAVAILABLE', '2026-10-25T02:20:00Z'),
      row('a', 'AVAILABLE', '2026-10-26T03:00:00Z'),
    ]);
    expect(events.map((e) => [e.storeName, e.at.toISOString(), e.soldOutAt?.toISOString() ?? null, e.stillAvailable]))
      .toEqual([
        ['Apple Central World', '2026-10-26T03:00:00.000Z', null, false],
        ['Apple Iconsiam', '2026-10-25T02:01:00.000Z', null, true],
        ['Apple Central World', '2026-10-25T02:00:00.000Z', '2026-10-25T02:20:00.000Z', false],
      ]);
  });

  it('names the period in months when it is whole months', () => {
    expect(periodLabel(180)).toBe('6 เดือน');
    expect(periodLabel(30)).toBe('1 เดือน');
    expect(periodLabel(45)).toBe('45 วัน');
  });

  it('formats durations in Thai', () => {
    expect(formatDuration(30_000)).toBe('ไม่ถึง 1 นาที');
    expect(formatDuration(12 * 60_000)).toBe('12 นาที');
    expect(formatDuration(125 * 60_000)).toBe('2 ชม. 5 นาที');
    expect(formatDuration(26 * 3_600_000)).toBe('1 วัน 2 ชม.');
  });

  it('summarises restocks per store and the busiest hour', () => {
    const sku = { variantId: 'v', model: 'iPhone Duo', color: 'Night Sky', colorTh: 'ไนท์สกาย', storage: '256GB', partNumber: 'MK2E4ZP/A' };
    const text = buildRestockHistoryText(sku, pairRestocks([
      row('a', 'AVAILABLE', '2026-10-24T03:05:00Z'),
      row('a', 'UNAVAILABLE', '2026-10-24T03:15:00Z'),
      row('b', 'AVAILABLE', '2026-10-25T03:40:00Z', 'Apple Iconsiam'),
      row('a', 'AVAILABLE', '2026-10-26T08:00:00Z', 'Apple Central World', true),
    ]), 30);
    expect(text).toContain('📈 สถิติของเคยเข้า');
    expect(text).toContain('📊 1 เดือนที่ผ่านมา ของเข้า 3 ครั้ง');
    expect(text).toContain('🆕 ล่าสุด 26/10 15:00 น.');
    expect(text).toContain('   • Central World — 2 ครั้ง');
    expect(text).toContain('• 26/10 15:00 น. · Central World\n   🟢 ยังมีของอยู่');
    expect(text).toContain('• 24/10 10:05 น. · Central World\n   ⏱️ หมดภายใน 10 นาที');
    expect(text).toContain('• 25/10 10:40 น. · Iconsiam\n   ❔ ไม่รู้ว่าหมดตอนไหน');
    expect(text).toContain('⏰ เข้าบ่อยช่วง 10:00–11:00 น. (2 ครั้ง)');
    expect(text).not.toMatch(/SKU|MK2E4/);
  });

  it('says so when a SKU has never restocked', () => {
    const sku = { variantId: 'v', model: 'iPhone Duo', color: 'Night Sky', colorTh: 'ไนท์สกาย', storage: '2TB', partNumber: 'X' };
    expect(buildRestockHistoryText(sku, [], 180)).toContain('😢 6 เดือนที่ผ่านมา ยังไม่เคยมีของเข้า');
  });
});

import { buildCurrentStockText } from '../src/stock/stock.current.js';

describe('current stock text', () => {
  const base = { model: 'iPhone Duo', color: 'x', colorTh: 'ไนท์สกาย', storage: '256GB', availableAt: [] as string[], unknown: false };

  it('says nothing is in stock and flags Apple outages separately', () => {
    const text = buildCurrentStockText({
      model: 'iPhone Duo', lastCheckedAt: null,
      skus: [base, { ...base, storage: '2TB', unknown: true }],
    });
    expect(text).toContain('⏰ เช็คล่าสุด -');
    expect(text).toContain('😢 ตอนนี้ยังไม่มีของ');
    expect(text).toContain('⚠️ เช็คไม่ได้ชั่วคราว\n   • ไนท์สกาย 2TB');
  });

  it('handles a model with no data yet', () => {
    expect(buildCurrentStockText({ model: 'iPhone 18 Pro Max', lastCheckedAt: null, skus: [] }))
      .toContain('⏳ ยังไม่มีข้อมูลรุ่นนี้');
  });
});
