import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  return {
    ...actual,
    env: { ...actual.env, TELEGRAM_BOT_TOKEN: 'tok', telegramChatIds: ['111', '222', '333'], TELEGRAM_DRY_RUN: false, MAX_RETRIES: 0 },
    isTelegramConfigured: () => true,
  };
});

import { emptyMutes, isMuted, type Mutes } from '../src/notification/alert.filter.js';
import { NotificationService } from '../src/notification/notification.service.js';
import { buildAvailabilityBody, filterSnapshot } from '../src/notification/stock.text.js';
import { TelegramNotificationService } from '../src/notification/telegram.service.js';
import type { StatusSnapshot } from '../src/notification/status.report.js';
import type { StockTransition } from '../src/stock/stock.types.js';

const recipients = (extra: string[] = [], removed: string[] = []) => ({
  all: vi.fn(async () => ['111', '222', '333', ...extra]),
  isAdmin: (chatId: string) => ['111', '222', '333'].includes(chatId),
  remove: vi.fn(async (chatId: string) => { removed.push(chatId); return true; }),
});

const mutes = (partial: Partial<Record<keyof Mutes, string[]>>): Mutes => ({
  model: new Set(partial.model ?? []),
  color: new Set(partial.color ?? []),
  storage: new Set(partial.storage ?? []),
  variant: new Set(partial.variant ?? []),
});

const transition = (color: string, colorTh: string, storage: string): StockTransition => ({
  stockId: `${color}-${storage}`,
  previousStatus: 'UNAVAILABLE',
  currentStatus: 'AVAILABLE',
  stock: {
    model: 'iPhone Duo', color, colorTh, storage, partNumber: 'P', basePart: 'B', priceTHB: null,
    storeName: 'Apple Central World', storeCode: 'R733', status: 'AVAILABLE', available: true,
    checkedAt: new Date('2026-10-26T03:00:00Z'),
  },
});

const snapshot: StatusSnapshot = {
  total: 8, available: 2, unavailable: 6, unknown: 0, lastCheckedAt: new Date('2026-10-26T03:00:00Z'),
  inStock: [
    { model: 'iPhone Duo', color: 'Night Sky', colorTh: 'ไนท์สกาย', storage: '256GB', storeName: 'Apple Central World' },
    { model: 'iPhone Duo', color: 'Star White', colorTh: 'สตาร์ไวท์', storage: '2TB', storeName: 'Apple Iconsiam' },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('alert filter', () => {
  it('mutes an item when any of model, color or storage is muted', () => {
    const item = { model: 'iPhone Duo', color: 'Night Sky', storage: '256GB' };
    expect(isMuted(emptyMutes(), item)).toBe(false);
    expect(isMuted(mutes({ color: ['Night Sky'] }), item)).toBe(true);
    expect(isMuted(mutes({ storage: ['256GB'] }), item)).toBe(true);
    expect(isMuted(mutes({ model: ['iPhone Duo'] }), item)).toBe(true);
    expect(isMuted(mutes({ color: ['Star White'], storage: ['2TB'] }), item)).toBe(false);
  });

  it('mutes exactly one variant and nothing else', () => {
    const nightSky256 = mutes({ variant: ['iPhone Duo::Night Sky::256GB'] });
    expect(isMuted(nightSky256, { model: 'iPhone Duo', color: 'Night Sky', storage: '256GB' })).toBe(true);
    expect(isMuted(nightSky256, { model: 'iPhone Duo', color: 'Star White', storage: '256GB' })).toBe(false);
    expect(isMuted(nightSky256, { model: 'iPhone Duo', color: 'Night Sky', storage: '512GB' })).toBe(false);
    expect(isMuted(nightSky256, { model: 'iPhone 18 Pro Max', color: 'Night Sky', storage: '256GB' })).toBe(false);
  });

  it('scopes color and storage to one model', () => {
    const duo = { model: 'iPhone Duo', color: 'Night Sky', storage: '2TB' };
    const proMax = { model: 'iPhone 18 Pro Max', color: 'Black', storage: '2TB' };
    const proMax2TBOff = mutes({ storage: ['iPhone 18 Pro Max::2TB'] });
    expect(isMuted(proMax2TBOff, proMax)).toBe(true);
    expect(isMuted(proMax2TBOff, duo)).toBe(false);
    expect(isMuted(mutes({ color: ['iPhone Duo::Night Sky'] }), duo)).toBe(true);
    expect(isMuted(mutes({ color: ['iPhone Duo::Night Sky'] }), { ...duo, model: 'iPhone 18 Pro Max' })).toBe(false);
  });

  it('hides muted in-stock rows and says how many were hidden', () => {
    const body = buildAvailabilityBody(filterSnapshot(snapshot, mutes({ storage: ['2TB'] })));
    expect(body).toContain('ไนท์สกาย 256GB');
    expect(body).not.toContain('สตาร์ไวท์ 2TB');
    expect(body).toContain('🔕 ซ่อนอีก 1 รายการที่คุณปิดการเตือนไว้');
  });

  it('renders a per-chat alert, or nothing when every new item is muted', async () => {
    const push = vi.fn().mockResolvedValue({ success: true, messageId: '1', results: [] });
    const service = new NotificationService({ push } as never, { logNotification: vi.fn() } as never,
      async () => snapshot, async () => undefined);
    await service.notify({
      transitions: [transition('Night Sky', 'ไนท์สกาย', '256GB')], firstRun: false,
    } as never);
    const message = push.mock.calls[0]![0];
    expect(message.renderFiltered(emptyMutes())).toContain('ไนท์สกาย 256GB 🆕');
    expect(message.renderFiltered(mutes({ color: ['Night Sky'] }))).toBeNull();
    const partial = message.renderFiltered(mutes({ storage: ['2TB'] }));
    expect(partial).toContain('🔔 เพิ่งเข้า 1 รายการ');
    expect(partial).not.toContain('สตาร์ไวท์');
  });
});

describe('Telegram per-chat delivery', () => {
  const sentTexts = (fetchMock: ReturnType<typeof vi.fn>) =>
    new Map(fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(init.body);
      return [body.chat_id, body.text];
    }));

  const okFetch = () => vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 }));

  it('sends the full text to unfiltered chats, a filtered one to others and skips fully muted chats', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const preferences = {
      getMutesFor: vi.fn().mockResolvedValue(new Map([
        ['111', emptyMutes()],
        ['222', mutes({ storage: ['2TB'] })],
        ['333', mutes({ color: ['Night Sky', 'Star White'] })],
      ])),
    };
    const service = new TelegramNotificationService(preferences as never, recipients() as never);
    const result = await service.send({
      flex: {} as never,
      text: 'FULL',
      renderFiltered: (m) => (m.color.size === 2 ? null : 'FILTERED'),
    });
    expect(result.success).toBe(true);
    expect(sentTexts(fetchMock)).toEqual(new Map([['111', 'FULL'], ['222', 'FILTERED']]));
  });

  it('falls back to the full alert for everyone when filters cannot be read', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const service = new TelegramNotificationService({ getMutesFor: vi.fn().mockRejectedValue(new Error('db')) } as never, recipients() as never);
    await service.send({ flex: {} as never, text: 'FULL', renderFiltered: () => null });
    expect([...sentTexts(fetchMock).values()]).toEqual(['FULL', 'FULL', 'FULL']);
  });

  it('does not touch the preference store for messages without a filter renderer', async () => {
    vi.stubGlobal('fetch', okFetch());
    const preferences = { getMutesFor: vi.fn() };
    await new TelegramNotificationService(preferences as never, recipients() as never).send({ flex: {} as never, text: 'X' });
    expect(preferences.getMutesFor).not.toHaveBeenCalled();
  });

  it('also alerts invited subscribers and drops one who blocked the bot', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const chat = JSON.parse(init.body).chat_id;
      return chat === '999'
        ? new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), { status: 403 })
        : new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const removed: string[] = [];
    const service = new TelegramNotificationService({ getMutesFor: vi.fn() } as never, recipients(['444', '999'], removed) as never);
    const result = await service.send({ flex: {} as never, text: 'X' });
    expect([...sentTexts(fetchMock).keys()]).toEqual(['111', '222', '333', '444', '999']);
    expect(removed).toEqual(['999']);
    expect(result.success).toBe(false);
  });

  it('sends the second stock copy to admins only - members get one alert', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const service = new TelegramNotificationService({ getMutesFor: vi.fn() } as never, recipients(['444', '555']) as never);
    await service.send({ flex: {} as never, text: 'FIRST' });
    expect([...sentTexts(fetchMock).keys()]).toEqual(['111', '222', '333', '444', '555']);
    fetchMock.mockClear();
    await service.send({ flex: {} as never, text: 'REMINDER', stockReminder: true });
    expect([...sentTexts(fetchMock).keys()]).toEqual(['111', '222', '333']);
  });

  it('turns alert links into Telegram HTML and leaves other texts plain', async () => {
    const { toTelegramBody } = await import('../src/notification/telegram.service.js');
    expect(toTelegramBody('สถานะ <ok> & ดี')).toEqual({ text: 'สถานะ <ok> & ดี' });
    expect(toTelegramBody('• [ไนท์สกาย 256GB](https://www.apple.com/th/xc/product/MK2E4ZP/A) 🆕\n<x>')).toEqual({
      text: '• <a href="https://www.apple.com/th/xc/product/MK2E4ZP/A">ไนท์สกาย 256GB</a> 🆕\n&lt;x&gt;',
      parse_mode: 'HTML',
    });
  });
});
