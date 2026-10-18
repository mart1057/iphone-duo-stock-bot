import { describe, expect, it, vi } from 'vitest';
import {
  buildAltText,
  buildPlainText,
  buildStockAlertMessage,
  buildStockBubble,
  buildSummaryBubble,
  type FlexCarousel,
} from '../src/notification/line.flex.js';
import { NotificationService } from '../src/notification/notification.service.js';
import type { StockCheckResult, StockTransition } from '../src/stock/stock.types.js';

const checkedAt = new Date('2026-09-17T16:30:15.000Z'); // 23:30:15 Asia/Bangkok

const transition = (
  colorTh: string,
  color: string,
  storage: string,
  storeName: string,
): StockTransition => ({
  stockId: `stock-${color}-${storage}-${storeName}`,
  previousStatus: 'UNAVAILABLE',
  currentStatus: 'AVAILABLE',
  stock: {
    model: 'iPhone 18 Pro Max',
    color,
    colorTh,
    storage,
    partNumber: 'MJXQ4ZP/A',
    basePart: 'MJXQ4',
    priceTHB: 52900,
    storeName,
    storeCode: 'R733',
    status: 'AVAILABLE',
    available: true,
    quote: 'พร้อมจำหน่าย วันนี้',
    checkedAt,
  },
});

const one = transition('เบอร์กันดี', 'Burgundy', '256GB', 'Apple Central World');
const three = [
  one,
  transition('ธารน้ำแข็ง', 'Glacier', '512GB', 'Apple Iconsiam'),
  transition('ดำ', 'Black', '1TB', 'Apple Central World'),
];

const result = (transitions: StockTransition[], firstRun = false): StockCheckResult => ({
  startedAt: checkedAt,
  finishedAt: checkedAt,
  durationMs: 1000,
  checked: 32,
  available: transitions.length,
  unavailable: 32 - transitions.length,
  unknown: 0,
  transitions,
  firstRun,
  errors: [],
  rateLimited: false,
});

describe('flex message', () => {
  it('builds a single detail bubble for one item', () => {
    const message = buildStockAlertMessage([one]);
    expect(message.type).toBe('flex');
    expect(message.contents.type).toBe('bubble');

    const json = JSON.stringify(message);
    expect(json).toContain('เบอร์กันดี');
    expect(json).toContain('256GB');
    expect(json).toContain('Apple Central World');
    expect(json).toContain('AVAILABLE');
    expect(json).toContain('23:30:15');
  });

  it('includes a "ดู Apple Store" URI button', () => {
    const bubble = buildStockBubble(one);
    const json = JSON.stringify(bubble.footer);
    expect(json).toContain('ดู Apple Store');
    expect(json).toContain('"type":"uri"');
    expect(json).toContain('apple.com');
  });

  it('merges several items found in one cycle into ONE message', () => {
    const message = buildStockAlertMessage(three);
    expect(message.contents.type).toBe('carousel');

    const carousel = message.contents as FlexCarousel;
    // Summary bubble first, then one detail bubble per item.
    expect(carousel.contents).toHaveLength(4);
    expect(JSON.stringify(carousel.contents[0])).toContain('พบสินค้า 3 รายการ');
  });

  it('falls back to a single summary bubble when there are many items', () => {
    const many = Array.from({ length: 16 }, (_, i) =>
      transition('ดำ', 'Black', `${i}GB`, 'Apple Iconsiam'),
    );
    const message = buildStockAlertMessage(many);
    expect(message.contents.type).toBe('bubble');
    expect(JSON.stringify(message)).toContain('พบสินค้า 16 รายการ');
  });

  it('writes a useful altText', () => {
    expect(buildAltText([one])).toContain('Apple Central World');
    expect(buildAltText(three)).toContain('3 รายการ');
  });

  it('renders the plain-text fallback in the requested layout', () => {
    const text = buildPlainText([one]);
    expect(text).toContain('🍎 iPhone 18 Pro Max STOCK ALERT');
    expect(text).toContain('🎨 สี: เบอร์กันดี');
    expect(text).toContain('💾 ความจุ: 256GB');
    expect(text).toContain('📍 สาขา: Apple Central World');
    expect(text).toContain('🟢 สถานะ: พร้อมจำหน่าย');
    expect(text).toContain('⏰ ตรวจพบ: 17/09/2026 23:30:15');
  });

  it('numbers items in the multi-item text fallback', () => {
    const text = buildPlainText(three);
    expect(text).toContain('🟢 พบสินค้า 3 รายการ');
    expect(text).toContain('1. เบอร์กันดี 256GB — Apple Central World');
    expect(text).toContain('2. ธารน้ำแข็ง 512GB — Apple Iconsiam');
  });

  it('refuses to build an empty alert', () => {
    expect(() => buildStockAlertMessage([])).toThrow();
  });

  it('summary bubble lists every item', () => {
    const json = JSON.stringify(buildSummaryBubble(three));
    expect(json).toContain('เบอร์กันดี');
    expect(json).toContain('ธารน้ำแข็ง');
    expect(json).toContain('ดำ');
  });
});

const stubSnapshot = () =>
  Promise.resolve({
    total: 32,
    available: 2,
    unavailable: 30,
    unknown: 0,
    lastCheckedAt: new Date('2026-09-17T16:30:15.000Z'),
    inStock: [
      { colorTh: 'เบอร์กันดี', storage: '256GB', storeName: 'Apple Central World' },
      { colorTh: 'ดำ', storage: '1TB', storeName: 'Apple Iconsiam' },
    ],
  });

describe('NotificationService', () => {
  const stubLine = () => ({ push: vi.fn().mockResolvedValue({ success: true, messageId: 'req-1' }) });
  const stubRepo = () => ({ logNotification: vi.fn().mockResolvedValue(undefined) });

  it('sends nothing when there are no transitions', async () => {
    const line = stubLine();
    const repo = stubRepo();
    await new NotificationService(line as never, repo as never, stubSnapshot).notify(result([]));
    expect(line.push).not.toHaveBeenCalled();
  });

  it('sends two copies of the grouped alert with distinct retry keys and logs', async () => {
    const line = stubLine();
    const repo = stubRepo();
    const pause = vi.fn().mockResolvedValue(undefined);
    await new NotificationService(line as never, repo as never, stubSnapshot, pause).notify(result(three));

    expect(line.push).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledWith(3000);
    expect(line.push.mock.calls[0]![1]).not.toBe(line.push.mock.calls[1]![1]);
    expect(line.push.mock.calls[1]![0]).toEqual({
      ...line.push.mock.calls[0]![0], stockReminder: true,
    });
    expect(repo.logNotification).toHaveBeenCalledTimes(6);
  });

  it('suppresses notifications on the first run', async () => {
    const line = stubLine();
    const repo = stubRepo();
    await new NotificationService(line as never, repo as never, stubSnapshot).notify(result(three, true));
    expect(line.push).not.toHaveBeenCalled();
  });

  it('records a failed push instead of throwing', async () => {
    const line = { push: vi.fn().mockResolvedValue({ success: false, messageId: null, error: '401' }) };
    const repo = stubRepo();

    await new NotificationService(line as never, repo as never, stubSnapshot, async () => {}).notify(result([one]));

    expect(repo.logNotification).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: '401' }),
    );
  });

  it('waits three seconds before the second copy and does not repeat on unchanged stock', async () => {
    vi.useFakeTimers();
    try {
      const line = stubLine();
      const service = new NotificationService(line as never, stubRepo() as never, stubSnapshot);
      const sending = service.notify(result([one]));
      await vi.advanceTimersByTimeAsync(0);
      expect(line.push).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2999);
      expect(line.push).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await sending;
      expect(line.push).toHaveBeenCalledTimes(2);
      await service.notify(result([]));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(line.push).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still sends the second copy when the first push throws', async () => {
    const line = stubLine();
    line.push.mockRejectedValueOnce(new Error('temporary failure'));
    const repo = stubRepo();
    await new NotificationService(line as never, repo as never, stubSnapshot, async () => {}).notify(result([one]));
    expect(line.push).toHaveBeenCalledTimes(2);
    expect(repo.logNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({ success: false }));
    expect(repo.logNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({ success: true }));
  });
});
