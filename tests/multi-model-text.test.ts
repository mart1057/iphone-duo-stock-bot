import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  const appleProducts = [
    { model: 'iPhone Duo', url: 'https://www.apple.com/th/shop/buy-iphone/iphone-duo' },
    { model: 'iPhone 18 Pro Max', url: 'https://www.apple.com/th/shop/buy-iphone/iphone-18-pro' },
  ];
  return {
    ...actual,
    env: { ...actual.env, appleProducts },
    isMultiModel: () => true,
    monitoredModelsLabel: () => 'iPhone Duo, iPhone 18 Pro Max',
    productUrlFor: (model?: string) => appleProducts.find((p) => p.model === model)?.url ?? appleProducts[0]!.url,
  };
});

import { buildPlainText, buildStockAlertMessage, toStoreLink } from '../src/notification/line.flex.js';
import { buildStockAlertText } from '../src/notification/stock.text.js';
import type { StockTransition } from '../src/stock/stock.types.js';

const t = (model: string, colorTh: string, storage: string): StockTransition => ({
  stockId: `${model}-${colorTh}-${storage}`,
  previousStatus: 'UNAVAILABLE',
  currentStatus: 'AVAILABLE',
  stock: {
    model, color: colorTh, colorTh, storage, partNumber: 'P', basePart: 'B', priceTHB: null,
    storeName: 'Apple Central World', storeCode: 'R733', status: 'AVAILABLE', available: true,
    checkedAt: new Date('2026-10-26T03:00:00Z'),
  },
});

describe('alerts with several models', () => {
  const transitions = [t('iPhone 18 Pro Max', 'เบอร์กันดี', '256GB'), t('iPhone Duo', 'ไนท์สกาย', '256GB')];

  it('names the models in the heading and on every row', () => {
    const text = buildStockAlertText(transitions, {
      total: 24, available: 2, unavailable: 22, unknown: 0, lastCheckedAt: new Date(),
      inStock: transitions.map(({ stock }) => ({ model: stock.model, color: stock.color, colorTh: stock.colorTh, storage: stock.storage, storeName: stock.storeName })),
    });
    expect(text).toContain('🚨 ของเข้าแล้ว!\n📱 iPhone 18 Pro Max / iPhone Duo');
    expect(text).toContain('• iPhone 18 Pro Max · เบอร์กันดี 256GB 🆕');
    expect(text).toContain('• iPhone Duo · ไนท์สกาย 256GB 🆕');
    expect(buildPlainText(transitions)).toContain('🟢 iPhone 18 Pro Max · [เบอร์กันดี 256GB](https://www.apple.com/th/xc/product/P)');
  });

  it('makes every in-stock row a link to that SKU\'s own page, with one short hint at the end', () => {
    const duo = { ...transitions[1]!, stock: { ...transitions[1]!.stock, partNumber: 'MK2E4ZP/A' } };
    const text = buildStockAlertText([duo], {
      total: 8, available: 2, unavailable: 6, unknown: 0, lastCheckedAt: new Date(),
      inStock: [
        { model: 'iPhone Duo', colorTh: 'ไนท์สกาย', storage: '256GB', storeName: 'Apple Central World', partNumber: 'MK2E4ZP/A' },
        { model: 'iPhone Duo', colorTh: 'สตาร์ไวท์', storage: '256GB', storeName: 'Apple Central World', partNumber: 'MK2D4ZP/A' },
      ],
    });
    expect(text).toContain('   • [ไนท์สกาย 256GB](https://www.apple.com/th/xc/product/MK2E4ZP/A) 🆕');
    expect(text).toContain('   • [สตาร์ไวท์ 256GB](https://www.apple.com/th/xc/product/MK2D4ZP/A)');
    expect(text.endsWith('👉 แตะชื่อรุ่นเพื่อเปิดหน้าจอง')).toBe(true);
    expect(buildPlainText([duo])).toContain('🟢 [ไนท์สกาย 256GB](https://www.apple.com/th/xc/product/MK2E4ZP/A)');
  });

  it('turns apple.com buy pages into store.apple.com links for alerts only', () => {
    expect(toStoreLink('https://www.apple.com/th/shop/buy-iphone/iphone-duo')).toBe('https://store.apple.com/th/buy-iphone/iphone-duo');
    expect(toStoreLink('https://www.apple.com/shop/buy-iphone/iphone-17')).toBe('https://store.apple.com/buy-iphone/iphone-17');
    expect(toStoreLink('https://example.com/x')).toBe('https://example.com/x');
  });

  it('links the LINE button to the SKU page (one item) or the model page (several)', () => {
    expect(JSON.stringify(buildStockAlertMessage([transitions[0]!]))).toContain('https://www.apple.com/th/xc/product/P');
    expect(JSON.stringify(buildStockAlertMessage(transitions))).toContain('https://store.apple.com/th/buy-iphone/iphone-18-pro');
  });
});

import { NotificationService } from '../src/notification/notification.service.js';

describe('stock alert with several models', () => {
  it('sends one message per model, each with only that model\'s stock', async () => {
    const push = vi.fn().mockResolvedValue({ success: true, messageId: '1', results: [] });
    const snapshot = {
      total: 24, available: 2, unavailable: 22, unknown: 0, lastCheckedAt: new Date('2026-10-26T13:00:00Z'),
      inStock: [
        { model: 'iPhone 18 Pro Max', color: 'Burgundy', colorTh: 'เบอร์กันดี', storage: '256GB', storeName: 'Apple Central World' },
        { model: 'iPhone Duo', color: 'Night Sky', colorTh: 'ไนท์สกาย', storage: '256GB', storeName: 'Apple Iconsiam' },
      ],
    };
    const service = new NotificationService({ push } as never, { logNotification: vi.fn() } as never, async () => snapshot, async () => undefined);
    await service.notify({
      transitions: [t('iPhone 18 Pro Max', 'เบอร์กันดี', '256GB'), t('iPhone Duo', 'ไนท์สกาย', '256GB')],
      firstRun: false,
    } as never);

    // 2 models x 2 copies, first copies before the reminders.
    expect(push).toHaveBeenCalledTimes(4);
    const texts: string[] = push.mock.calls.map(([message]) => message.text);
    const [proMax, duo] = texts;
    expect(proMax).toContain('📱 iPhone 18 Pro Max\n🔔 เพิ่งเข้า 1 รายการ');
    expect(proMax).toContain('   • เบอร์กันดี 256GB 🆕');
    expect(proMax).not.toContain('Duo');
    expect(proMax).not.toContain('Iconsiam');
    expect(duo).toContain('📱 iPhone Duo\n🔔 เพิ่งเข้า 1 รายการ');
    expect(duo).not.toContain('Pro Max');
    expect(push.mock.calls.map(([message]) => message.stockReminder ?? false)).toEqual([false, false, true, true]);

    // A chat that muted the Duo gets the Pro Max message and nothing for the Duo.
    const muteDuo = { model: new Set(['iPhone Duo']), color: new Set<string>(), storage: new Set<string>(), variant: new Set<string>() };
    expect(push.mock.calls[0]![0].renderFiltered(muteDuo)).toContain('เบอร์กันดี');
    expect(push.mock.calls[1]![0].renderFiltered(muteDuo)).toBeNull();
  });
});
