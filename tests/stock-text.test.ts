import { describe, expect, it } from 'vitest';
import {
  buildAvailabilityBody,
  buildStockAlertText,
  groupByStore,
  itemKey,
} from '../src/notification/stock.text.js';
import type { StatusSnapshot } from '../src/notification/status.report.js';

const snapshot = (
  inStock: Array<{ colorTh: string; storage: string; storeName: string }>,
  overrides: Partial<StatusSnapshot> = {},
): StatusSnapshot => ({
  total: 32,
  available: inStock.length,
  unavailable: 32 - inStock.length,
  unknown: 0,
  lastCheckedAt: new Date('2026-09-20T10:18:20.000Z'), // 17:18:20 Asia/Bangkok
  inStock,
  ...overrides,
});

const four = [
  { colorTh: 'ดำ', storage: '2TB', storeName: 'Apple Central World' },
  { colorTh: 'ธารน้ำแข็ง', storage: '2TB', storeName: 'Apple Iconsiam' },
  { colorTh: 'ดำ', storage: '2TB', storeName: 'Apple Iconsiam' },
  { colorTh: 'ธารน้ำแข็ง', storage: '2TB', storeName: 'Apple Central World' },
];

describe('groupByStore', () => {
  it('puts every item under its branch', () => {
    const grouped = groupByStore(four);

    expect([...grouped.keys()]).toEqual(['Apple Central World', 'Apple Iconsiam']);
    expect(grouped.get('Apple Central World')).toHaveLength(2);
    expect(grouped.get('Apple Iconsiam')).toHaveLength(2);
  });

  it('does not mutate the caller array', () => {
    const input = [...four];
    groupByStore(input);
    expect(input).toEqual(four);
  });
});

describe('buildAvailabilityBody', () => {
  it('lists each branch with its items', () => {
    const text = buildAvailabilityBody(snapshot(four));

    expect(text).toContain('มีของ: 4 / 32');
    expect(text).toContain('ไม่มีของ: 28');
    expect(text).toContain('ตรวจล่าสุด: 20/09/2026 17:18:20');
    expect(text).toContain('📍 Apple Central World');
    expect(text).toContain('📍 Apple Iconsiam');
    expect(text).toContain('   • ดำ 2TB');
  });

  it('says so plainly when nothing is in stock', () => {
    const text = buildAvailabilityBody(snapshot([]));
    expect(text).toContain('🔴 ยังไม่มีสินค้าพร้อมจำหน่าย');
    expect(text).not.toContain('📍');
  });

  /// "ไม่มีของ" and "could not reach Apple" must never look the same.
  it('surfaces unknown count only when it is not zero', () => {
    expect(buildAvailabilityBody(snapshot(four))).not.toContain('ไม่ทราบสถานะ');
    expect(buildAvailabilityBody(snapshot(four, { unknown: 5 }))).toContain('ไม่ทราบสถานะ: 5');
  });
});

describe('buildStockAlertText', () => {
  const transition = (colorTh: string, storage: string, storeName: string) => ({
    stock: { model: 'iPhone 18 Pro Max', colorTh, storage, storeName },
  });

  it('leads with what just changed, then shows everything available', () => {
    const text = buildStockAlertText([transition('ดำ', '2TB', 'Apple Iconsiam')], snapshot(four));

    expect(text).toContain('🍎 iPhone 18 Pro Max STOCK ALERT');
    expect(text).toContain('🔔 เพิ่งมีของ 1 รายการ');
    expect(text).toContain('📍 Apple Central World');
    expect(text).toContain('📍 Apple Iconsiam');
  });

  /// The 🆕 marker is the whole point: it separates "this is why you got
  /// pinged" from "and here is the rest of what is on the shelf".
  it('marks only the items that just became available', () => {
    const text = buildStockAlertText([transition('ดำ', '2TB', 'Apple Iconsiam')], snapshot(four));

    const iconsiamBlack = text
      .split('\n')
      .find((line) => line.includes('ดำ 2TB') && text.indexOf(line) > text.indexOf('Apple Iconsiam'));
    expect(iconsiamBlack).toContain('🆕');
    expect(text.match(/🆕/g)).toHaveLength(1);
  });

  it('marks every item when the whole set is new', () => {
    const transitions = four.map((item) =>
      transition(item.colorTh, item.storage, item.storeName),
    );
    const text = buildStockAlertText(transitions, snapshot(four));

    expect(text).toContain('🔔 เพิ่งมีของ 4 รายการ');
    expect(text.match(/🆕/g)).toHaveLength(4);
  });
});

describe('itemKey', () => {
  it('distinguishes the same variant at different branches', () => {
    expect(itemKey(four[0]!)).not.toBe(itemKey(four[2]!));
  });
});
