import { env } from '../src/config/env.js';
import { membershipSettings } from '../src/notification/membership.settings.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/notification/membership.settings.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/notification/membership.settings.js')>(),
  membershipSettings: { price: vi.fn().mockResolvedValue(null), setPrice: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../src/config/env.js', () => ({
  env: { telegramChatIds: ['123'], TELEGRAM_DRY_RUN: false, STOCK_CHECK_WINDOW_ENABLED: true, STOCK_CHECK_CRON: '', TELEGRAM_INVITE_CODE: 'secret-code-1', TELEGRAM_PAYMENT_QR_PATH: '', MEMBER_EXPIRY_CHECK_HOUR: 9, APPLE_MODEL_FILTER: 'iPhone Duo',
    appleProducts: [{ model: 'iPhone Duo', url: 'https://x/duo' }, { model: 'iPhone 18 Pro Max', url: 'https://x/pro' }] },
  isTelegramConfigured: () => true,
  monitoredModelsLabel: () => 'iPhone Duo, iPhone 18 Pro Max',
}));
vi.mock('../src/scheduler/stock.scheduler.js', () => ({
  stockScheduler: { getStatusText: () => '🔎 กำลังตรวจสต็อก', start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/notification/status.report.js', () => ({
  readStatus: vi.fn().mockResolvedValue({}),
  buildStatusMessage: () => ({ text: 'ตรวจล่าสุด: วันนี้' }),
}));
vi.mock('../src/notification/telegram.service.js', () => ({
  telegramNotificationService: {
    reply: vi.fn().mockResolvedValue(true),
    sendMenu: vi.fn().mockResolvedValue(true),
    copyReceipt: vi.fn().mockResolvedValue(true),
    sendPaymentQr: vi.fn().mockResolvedValue(true),
    editMenu: vi.fn().mockResolvedValue(true),
    answerCallback: vi.fn().mockResolvedValue(undefined),
    setCommands: vi.fn().mockResolvedValue(true),
    clearCommands: vi.fn().mockResolvedValue(true),
    sendUnchecked: vi.fn().mockResolvedValue(true),
    getBotUsername: vi.fn().mockResolvedValue('duo_stock_bot'),
  },
}));
vi.mock('../src/notification/telegram.recipients.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/notification/telegram.recipients.js')>();
  const members = new Map<string, { chatId: string; name: string | null; username: string | null; joinedAt: Date; approved?: boolean; expiresOn?: Date | null }>();
  const approved = () => [...members.values()].filter((m) => m.approved !== false);
  return {
    ...actual,
    inviteCodeMatches: (candidate?: string) => actual.inviteCodeMatches(candidate, 'secret-code-1'),
    __members: members,
    telegramRecipients: {
      isAdmin: (chatId: string) => chatId === '123',
      isMember: vi.fn(async (chatId: string) => chatId === '123' || approved().some((m) => m.chatId === chatId)),
      subscribers: vi.fn(async () => approved()),
      pending: vi.fn(async () => [...members.values()].filter((m) => m.approved === false)),
      isPending: vi.fn(async (chatId: string) => members.get(chatId)?.approved === false),
      find: vi.fn(async (chatId: string) => members.get(chatId)),
      request: vi.fn(async (s: { chatId: string; name?: string | null; username?: string | null }) => {
        if (members.has(s.chatId)) return false;
        members.set(s.chatId, { chatId: s.chatId, name: s.name ?? null, username: s.username ?? null, joinedAt: new Date('2026-10-26T05:00:00Z'), approved: false });
        return true;
      }),
      approve: vi.fn(async (chatId: string) => {
        const m = members.get(chatId);
        if (!m || m.approved !== false) return false;
        m.approved = true;
        return true;
      }),
      remove: vi.fn(async (chatId: string) => members.delete(chatId)),
      setExpiry: vi.fn(async (chatId: string, key: string | null) => {
        const m = members.get(chatId);
        if (!m || m.approved === false) return false;
        m.expiresOn = key ? new Date(`${key}T00:00:00Z`) : null;
        return true;
      }),
    },
  };
});
vi.mock('../src/stock/model.pause.js', () => {
  const paused = new Map<string, Date>();
  return {
    __paused: paused,
    modelPauseStore: {
      list: vi.fn(async () => paused),
      pausedModels: vi.fn(async () => new Set(paused.keys())),
      toggle: vi.fn(async (model: string) => {
        if (paused.delete(model)) return false;
        paused.set(model, new Date('2026-10-26T13:40:00Z'));
        return true;
      }),
    },
  };
});
import * as pauseModule from '../src/stock/model.pause.js';
import * as recipientsModule from '../src/notification/telegram.recipients.js';
import { TelegramCommandService } from '../src/notification/telegram.commands.js';
import { telegramNotificationService } from '../src/notification/telegram.service.js';
import { stockScheduler } from '../src/scheduler/stock.scheduler.js';
import { readStatus } from '../src/notification/status.report.js';
import { emptyMutes, type MuteKind, type Mutes } from '../src/notification/alert.filter.js';
import type { SkuOption } from '../src/stock/restock.history.js';

const skus: SkuOption[] = [
  { variantId: 'v1', model: 'iPhone Duo', color: 'Night Sky', colorTh: 'ไนท์สกาย', storage: '256GB', partNumber: 'MK2E4ZP/A' },
  { variantId: 'v2', model: 'iPhone Duo', color: 'Star White', colorTh: 'สตาร์ไวท์', storage: '256GB', partNumber: 'MK2D4ZP/A' },
  { variantId: 'v3', model: 'iPhone Duo', color: 'Night Sky', colorTh: 'ไนท์สกาย', storage: '2TB', partNumber: 'MK2L4ZP/A' },
  { variantId: 'v4', model: 'iPhone 18 Pro Max', color: 'Burgundy', colorTh: 'เบอร์กันดี', storage: '256GB', partNumber: 'MJXQ4ZP/A' },
  { variantId: 'v5', model: 'iPhone 18 Pro Max', color: 'Black', colorTh: 'ดำ', storage: '2TB', partNumber: 'MJY04ZP/A' },
];
const duoOnly = skus.filter((sku) => sku.model === 'iPhone Duo');

/// In-memory stand-ins for the DB-backed preference store and history repo.
const fakes = (catalogue: SkuOption[] = skus) => {
  const muted = new Map<MuteKind, Set<string>>([['model', new Set()], ['color', new Set()], ['storage', new Set()], ['variant', new Set()]]);
  const preferences = {
    getMutes: vi.fn(async (): Promise<Mutes> => ({
      model: new Set(muted.get('model')), color: new Set(muted.get('color')),
      storage: new Set(muted.get('storage')), variant: new Set(muted.get('variant')),
    })),
    unmute: vi.fn(async (_chat: string, kind: MuteKind, values: string[]) => { values.forEach((v) => muted.get(kind)!.delete(v)); }),
    toggle: vi.fn(async (_chat: string, kind: MuteKind, value: string) => {
      const set = muted.get(kind)!;
      if (set.has(value)) { set.delete(value); return false; }
      set.add(value); return true;
    }),
    muteAll: vi.fn(async (_chat: string, kind: MuteKind, values: string[]) => { values.forEach((v) => muted.get(kind)!.add(v)); }),
    unmuteAll: vi.fn(async (_chat: string, kind?: MuteKind) => {
      for (const [k, set] of muted) if (!kind || k === kind) set.clear();
    }),
  };
  const history = {
    listSkus: vi.fn(async () => catalogue),
    restockCounts: vi.fn(async () => new Map([['v1', 4]])),
    restocks: vi.fn(async () => [
      { storeName: 'Apple Central World', at: new Date('2026-10-26T03:15:00Z'), soldOutAt: new Date('2026-10-26T03:27:00Z'), stillAvailable: false },
    ]),
    retentionDays: () => 30,
  };
  const currentStock = {
    forModel: vi.fn(async (model: string) => ({
      model,
      lastCheckedAt: new Date('2026-10-26T13:25:03Z'),
      skus: catalogue.filter((sku) => sku.model === model).map((sku, index) => ({
        model, color: sku.color, colorTh: sku.colorTh, storage: sku.storage,
        availableAt: index === 0 ? ['Apple Central World', 'Apple Iconsiam'] : [],
        unknown: false,
      })),
    })),
  };
  return {
    muted, preferences, history, currentStock,
    service: new TelegramCommandService(preferences as never, history as never, undefined, currentStock as never),
  };
};

const tap = (data: string, chat = 123) => ({
  update_id: 5, callback_query: { id: 'cb1', data, message: { message_id: 77, chat: { id: chat } } },
});
const lastEdit = () => vi.mocked(telegramNotificationService.editMenu).mock.calls.at(-1)!;
const buttons = (keyboard: Array<Array<{ text: string; callback_data: string }>>) => keyboard.flat();

const update = (text: string, id = 123) => ({
  update_id: 1, message: { text, chat: { id } },
});

const members = (recipientsModule as unknown as { __members: Map<string, unknown> }).__members;
const pausedModels = (pauseModule as unknown as { __paused: Map<string, Date> }).__paused;
beforeEach(() => { vi.clearAllMocks(); members.clear(); pausedModels.clear(); vi.mocked(membershipSettings.price).mockResolvedValue(null); });

describe('Telegram status commands', () => {
  it.each(['/status', '/status@my_bot', 'สถานะ', 'เช็คสถานะ', 'สถานะการเช็ค'])('answers %s in the requesting chat', async (text) => {
    await new TelegramCommandService().handleUpdate(update(text));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('กำลังตรวจสต็อก'));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('ตรวจล่าสุด: วันนี้'));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('05:30–22:00'));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('30 วินาที'));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('08:00–09:00 น. สุ่ม 10–15 วินาที'));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('เริ่มเองเมื่อถึงเวลา'));
  });

  it.each(['/pause', '/stop', '/stop@my_bot', '/resume', '/resume@my_bot'])('controls checks with %s', async (text) => {
    await new TelegramCommandService().handleUpdate(update(text));
    expect(text.startsWith('/resume') ? stockScheduler.start : stockScheduler.stop).toHaveBeenCalledTimes(1);
    expect(readStatus).not.toHaveBeenCalled();
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.any(String));
  });

  it('rejects control commands from unauthorized chats', async () => {
    await new TelegramCommandService().handleUpdate(update('/stop', 999));
    await new TelegramCommandService().handleUpdate(update('/resume', 999));
    expect(stockScheduler.stop).not.toHaveBeenCalled();
    expect(stockScheduler.start).not.toHaveBeenCalled();
  });

  it('does not query or reply to unauthorized chats or unrelated messages', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(update('/status', 999));
    await service.handleUpdate(update('hello'));
    await service.handleUpdate({ update_id: 2 });
    expect(readStatus).not.toHaveBeenCalled();
    expect(telegramNotificationService.reply).not.toHaveBeenCalled();
  });

  it('answers with scheduler state when the database is unavailable', async () => {
    vi.mocked(readStatus).mockRejectedValueOnce(new Error('database unavailable'));
    await new TelegramCommandService().handleUpdate(update('/status'));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('อ่านผลเช็คล่าสุดไม่ได้'));
  });

  it('cancels a pending poll on shutdown and starts only one loop', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const service = new TelegramCommandService();
      service.start();
      service.start();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await service.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Telegram menus', () => {
  it('writes the member list to every scope and to each member\'s own chat', async () => {
    members.set('555', { chatId: '555', name: 'Nok', username: null, joinedAt: new Date() });
    await new TelegramCommandService().registerCommandMenus();
    const calls = vi.mocked(telegramNotificationService.setCommands).mock.calls
      .map(([commands, target]) => `${target ?? 'default'}:${commands[0]!.command}:${commands.length}`);
    expect(calls).toEqual([
      'default:menu:5', 'all_private_chats:menu:5', 'all_group_chats:menu:5', '123:menu:11', '555:menu:5',
    ]);
  });

  it('puts /menu first in Telegram\'s command list, for members and the owner', async () => {
    const { MEMBER_COMMANDS, ADMIN_COMMANDS } = await import('../src/notification/telegram.commands.js');
    expect(MEMBER_COMMANDS.map((c) => c.command)).toEqual(['menu', 'stock', 'alerts', 'history', 'leave']);
    expect(ADMIN_COMMANDS.map((c) => c.command)).toEqual(['menu', 'stock', 'alerts', 'history', 'status', 'models', 'invite', 'members', 'news', 'pause', 'resume']);
  });

  it.each(['/menu', '/help', 'เมนู'])('opens the main menu with %s', async (text) => {
    await new TelegramCommandService().handleUpdate(update(text));
    const [, , keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]!;
    expect(buttons(keyboard).map((b) => b.callback_data)).toEqual(['s', 'a', 'h', 'mo', 'st', 'inv', 'sl', 'nw', 'dml:0', 'fee']);
  });

  it('lists every model, then each color + size of one model as its own button', async () => {
    const { service } = fakes();
    await service.handleUpdate(update('/alerts'));
    const [chat, text, keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]!;
    expect(chat).toBe('123');
    expect(text).toContain('📱 iPhone Duo\n   ✅ เตือนทุกแบบ (3 แบบ)');
    expect(text).toContain('📊 เตือนอยู่ 5 จาก 5 แบบ');
    expect(buttons(keyboard).map((b) => b.callback_data)).toEqual(['am:iPhone Duo', 'am:iPhone 18 Pro Max', 'areset', 'm']);

    await service.handleUpdate(tap('am:iPhone Duo'));
    const [, messageId, , modelKeyboard] = lastEdit();
    expect(messageId).toBe(77);
    // size first, then color - one button per exact variant
    expect(buttons(modelKeyboard)).toEqual([
      { text: '✅ เปิดทุกแบบ', callback_data: 'avon:iPhone Duo' },
      { text: '🔕 ปิดทุกแบบ', callback_data: 'avoff:iPhone Duo' },
      { text: '✅ ไนท์สกาย 256GB', callback_data: 'av:iPhone Duo:0' },
      { text: '✅ สตาร์ไวท์ 256GB', callback_data: 'av:iPhone Duo:1' },
      { text: '✅ ไนท์สกาย 2TB', callback_data: 'av:iPhone Duo:2' },
      { text: '⬅️ เลือกรุ่นอื่น', callback_data: 'a' },
      { text: '🏠 เมนูหลัก', callback_data: 'm' },
    ]);
  });

  it('muting ไนท์สกาย 256GB leaves สตาร์ไวท์ 256GB and ไนท์สกาย 2TB on', async () => {
    const { service, muted, preferences } = fakes();
    await service.handleUpdate(tap('av:iPhone Duo:0'));
    expect(preferences.toggle).toHaveBeenCalledWith('123', 'variant', 'iPhone Duo::Night Sky::256GB');
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '🔕 ไม่เตือน ไนท์สกาย 256GB แล้ว');
    expect(buttons(lastEdit()[3]).map((b) => b.text)).toEqual(
      expect.arrayContaining(['🔕 ไนท์สกาย 256GB', '✅ สตาร์ไวท์ 256GB', '✅ ไนท์สกาย 2TB']),
    );
    expect(lastEdit()[2]).toContain('📊 เตือนอยู่ 2 จาก 3 แบบ');

    await service.handleUpdate(tap('av:iPhone Duo:0'));
    expect(muted.get('variant')).toEqual(new Set());
  });

  it('turns every variant of a model off and back on', async () => {
    const { service, muted } = fakes();
    await service.handleUpdate(tap('avoff:iPhone 18 Pro Max'));
    expect(muted.get('variant')).toEqual(new Set(['iPhone 18 Pro Max::Burgundy::256GB', 'iPhone 18 Pro Max::Black::2TB']));
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '🔕 ปิดเตือนทุกแบบของ iPhone 18 Pro Max แล้ว');
    expect(lastEdit()[2]).toContain('🔕 ตอนนี้ปิดเตือนทุกแบบของรุ่นนี้');
    await service.handleUpdate(tap('a'));
    expect(lastEdit()[2]).toContain('📱 iPhone 18 Pro Max\n   🔕 ปิดเตือนทุกแบบ');
    expect(lastEdit()[2]).toContain('📊 เตือนอยู่ 3 จาก 5 แบบ');
    await service.handleUpdate(tap('avon:iPhone 18 Pro Max'));
    expect(muted.get('variant')).toEqual(new Set());
  });

  it('rewrites old color / size settings as variants before the first tap', async () => {
    const { service, muted } = fakes();
    // The screenshot case: Duo with ไนท์สกาย off and 256GB off (old layout).
    muted.get('color')!.add('iPhone Duo::Night Sky');
    muted.get('storage')!.add('iPhone Duo::256GB');
    await service.handleUpdate(tap('av:iPhone Duo:1')); // turn สตาร์ไวท์ 256GB back on
    expect(muted.get('color')).toEqual(new Set());
    expect(muted.get('storage')).toEqual(new Set());
    expect(muted.get('variant')).toEqual(new Set(['iPhone Duo::Night Sky::256GB', 'iPhone Duo::Night Sky::2TB']));
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '✅ เตือน สตาร์ไวท์ 256GB แล้ว');
  });

  it('answers taps on buttons from the old layout without changing anything', async () => {
    const { service, preferences } = fakes();
    await service.handleUpdate(tap('at:s:1:2TB'));
    expect(preferences.toggle).not.toHaveBeenCalled();
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', 'เมนูนี้เปลี่ยนแล้ว 👇 เลือกใหม่ได้เลย');
  });

  it('goes straight to the model page when only one model is monitored', async () => {
    const { service } = fakes(duoOnly);
    await service.handleUpdate(update('/alerts'));
    const [, text, keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]!;
    expect(text).toContain('📱 iPhone Duo');
    expect(buttons(keyboard).map((b) => b.callback_data)).toContain('av:iPhone Duo:0');
    expect(buttons(keyboard).map((b) => b.callback_data)).not.toContain('a');
  });

  it('picks a model, then a SKU, then shows its restock history', async () => {
    const { service, history } = fakes();
    await service.handleUpdate(update('/history'));
    const [, text, keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]!;
    expect(text).toContain('📈 สถิติของเคยเข้า');
    expect(text).toContain('1 เดือนที่ผ่านมา');
    expect(buttons(keyboard)).toEqual(expect.arrayContaining([
      { text: '📱 iPhone Duo · 4 ครั้ง', callback_data: 'hm:iPhone Duo' },
      { text: '📱 iPhone 18 Pro Max · -', callback_data: 'hm:iPhone 18 Pro Max' },
    ]));

    await service.handleUpdate(tap('hm:iPhone Duo'));
    expect(buttons(lastEdit()[3])).toEqual(expect.arrayContaining([
      { text: 'ไนท์สกาย 256GB · 4 ครั้ง', callback_data: 'hv:v1' },
      { text: 'ไนท์สกาย 2TB · -', callback_data: 'hv:v3' },
    ]));

    await service.handleUpdate(tap('hv:v1'));
    expect(history.restocks).toHaveBeenCalledWith('v1');
    const shown = lastEdit()[2];
    expect(shown).toContain('📱 iPhone Duo\n🎨 ไนท์สกาย  💾 256GB');
    expect(shown).toContain('• 26/10 10:15 น. · Central World\n   ⏱️ หมดภายใน 12 นาที');
    expect(buttons(lastEdit()[3])).toContainEqual({ text: '⬅️ เลือกแบบอื่น', callback_data: 'hm:iPhone Duo' });
  });

  it('/stock answers at once with what is in stock across every model', async () => {
    const { service, currentStock, muted } = fakes();
    muted.get('color')!.add('iPhone 18 Pro Max::Burgundy');
    await service.handleUpdate(update('/stock'));
    expect(currentStock.forModel.mock.calls.map(([model]) => model)).toEqual(['iPhone Duo', 'iPhone 18 Pro Max']);
    const [, text, keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]!;
    expect(text).toContain('📦 ของที่มีตอนนี้');
    expect(text).toContain('⏰ เช็คล่าสุด 26/10 20:25 น.');
    expect(text).toContain('📱 iPhone Duo\n✅ มีของ 1 จาก 3 แบบ\n   🟢 ไนท์สกาย 256GB\n       📍 Central World, Iconsiam');
    expect(text).toContain('📱 iPhone 18 Pro Max\n✅ มีของ 1 จาก 2 แบบ\n   🟢 เบอร์กันดี 256GB 🔕');
    expect(text).not.toContain('ดำ 2TB'); // sold out: counted, not listed
    expect(buttons(keyboard).map((b) => b.callback_data)).toEqual(['sa', 'sm:iPhone Duo', 'sm:iPhone 18 Pro Max', 'm']);

    await service.handleUpdate(tap('sm:iPhone 18 Pro Max'));
    expect(lastEdit()[2]).toContain('🔴 หมด\n   • ดำ 2TB');
    expect(buttons(lastEdit()[3]).map((b) => b.callback_data)).toEqual(['sm:iPhone 18 Pro Max', 's', 'm']);
  });

  it('the 📦 button asks which model first, then shows only that model', async () => {
    const { service, currentStock } = fakes();
    pausedModels.set('iPhone 18 Pro Max', new Date());
    await service.handleUpdate(tap('s'));
    expect(currentStock.forModel).not.toHaveBeenCalled();
    expect(lastEdit()[2]).toContain('👇 อยากดูรุ่นไหน');
    expect(buttons(lastEdit()[3])).toEqual([
      { text: '📱 iPhone Duo', callback_data: 'sm:iPhone Duo' },
      { text: '⏸️ iPhone 18 Pro Max (หยุดเช็คอยู่)', callback_data: 'sm:iPhone 18 Pro Max' },
      { text: '📦 ดูทุกรุ่นพร้อมกัน', callback_data: 'sa' },
      { text: '🏠 เมนูหลัก', callback_data: 'm' },
    ]);

    await service.handleUpdate(tap('sm:iPhone Duo'));
    expect(currentStock.forModel).toHaveBeenCalledWith('iPhone Duo');
    expect(lastEdit()[2]).toContain('📱 iPhone Duo');
    expect(lastEdit()[2]).not.toContain('iPhone 18 Pro Max');
    expect(buttons(lastEdit()[3]).map((b) => b.callback_data)).toEqual(['sm:iPhone Duo', 's', 'm']);
  });

  it('the 📦 button skips the question when only one model is monitored', async () => {
    const { service } = fakes(duoOnly);
    await service.handleUpdate(tap('s'));
    expect(lastEdit()[2]).toContain('✅ มีของ 1 จาก 3 แบบ');
    expect(buttons(lastEdit()[3]).map((b) => b.callback_data)).toEqual(['sm:iPhone Duo', 'm']);
  });

  it('lets members use /stock too', async () => {
    const { service } = fakes(duoOnly);
    members.set('555', { chatId: '555', name: 'Nok', username: null, joinedAt: new Date() });
    await service.handleUpdate(update('สต็อก', 555));
    const [chat, text] = vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]!;
    expect(chat).toBe('555');
    expect(text).toContain('✅ มีของ 1 จาก 3 แบบ');
  });

  it('lists SKUs directly when only one model is monitored', async () => {
    const { service } = fakes(duoOnly);
    await service.handleUpdate(update('/history'));
    const [, , keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]!;
    expect(buttons(keyboard)).toContainEqual({ text: 'ไนท์สกาย 256GB · 4 ครั้ง', callback_data: 'hv:v1' });
  });

  it('ignores button taps from unauthorized chats', async () => {
    const { service, preferences } = fakes();
    await service.handleUpdate(tap('avoff:iPhone Duo', 999));
    expect(preferences.muteAll).not.toHaveBeenCalled();
    expect(telegramNotificationService.editMenu).not.toHaveBeenCalled();
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '🔒 ใช้เมนูนี้ไม่ได้');
  });

  it('answers the tap even when the database fails', async () => {
    const { service, history } = fakes();
    history.listSkus.mockRejectedValueOnce(new Error('db down'));
    await service.handleUpdate(tap('h'));
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '😵 ทำไม่สำเร็จ ลองใหม่อีกครั้งนะ');
  });

  it('keeps empty mutes helper consistent', () => {
    expect([...emptyMutes().color]).toEqual([]);
  });
});

describe('Telegram invite link', () => {
  const join = (text: string, id = 555, extra: Record<string, unknown> = {}) => ({
    update_id: 9,
    message: { text, chat: { id, type: 'private', first_name: 'Nok', username: 'nok_99', ...extra }, from: { first_name: 'Nok', username: 'nok_99' } },
  });

  it('the right code only creates a request: the owner must approve first', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(join('/start secret-code-1'));
    expect(members.get('555')).toMatchObject({ approved: false });
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('รอเจ้าของบอทตรวจสอบและอนุมัติ'));
    const toOwner = vi.mocked(telegramNotificationService.sendMenu).mock.calls.find(([chat]) => chat === '123')!;
    expect(toOwner[1]).toContain('🙋 มีคนขอเข้าร่วม\n👤 Nok @nok_99');
    expect(toOwner[2].flat()).toEqual([
      { text: '✅ อนุมัติ', callback_data: 'ja:555' },
      { text: '❌ ปฏิเสธ', callback_data: 'jr:555' },
    ]);

    // While waiting: no menus, no alerts, tapping the link again just says "waiting".
    await service.handleUpdate(join('/menu'));
    await service.handleUpdate(join('/stock'));
    expect(vi.mocked(telegramNotificationService.sendMenu).mock.calls.filter(([chat]) => chat === '555')).toHaveLength(0);
    await service.handleUpdate(join('/start secret-code-1'));
    expect(telegramNotificationService.sendUnchecked).toHaveBeenLastCalledWith('555', expect.stringContaining('รอเจ้าของบอทตรวจสอบและอนุมัติ'));
    expect(vi.mocked(telegramNotificationService.sendMenu).mock.calls.filter(([chat]) => chat === '123')).toHaveLength(1);
  });

  it('approving makes them a member and welcomes them; a second tap does nothing', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(join('/start secret-code-1'));
    await service.handleUpdate(tap('ja:555'));
    expect(members.get('555')).toMatchObject({ approved: true });
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '✅ อนุมัติ Nok @nok_99 แล้ว');
    const [, , askText, askKeyboard] = vi.mocked(telegramNotificationService.editMenu).mock.calls.at(-1)!;
    expect(askText).toContain('✅ อนุมัติ Nok @nok_99 แล้ว');
    expect(askText).toContain('📅 สมาชิก Nok @nok_99 หมดอายุวันไหน?');
    expect(askKeyboard.flat()).toContainEqual({ text: '1 เดือน', callback_data: 'es:30:555' });
    expect(askKeyboard.flat()).toContainEqual({ text: '✏️ พิมพ์วันที่เอง', callback_data: 'ec:555' });
    const welcome = vi.mocked(telegramNotificationService.sendMenu).mock.calls.find(([chat]) => chat === '555')!;
    expect(welcome[1]).toContain('🎉 ได้รับอนุมัติแล้ว ยินดีต้อนรับ!');
    expect(telegramNotificationService.setCommands).toHaveBeenCalledWith(expect.any(Array), '555');

    await service.handleUpdate(tap('ja:555'));
    expect(telegramNotificationService.answerCallback).toHaveBeenLastCalledWith('cb1', 'คำขอนี้จัดการไปแล้ว');
  });

  it('after approving, a preset sets the expiry and tells the member', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-27T05:00:00Z'), toFake: ['Date'] });
    try {
      const service = new TelegramCommandService();
      await service.handleUpdate(join('/start secret-code-1'));
      await service.handleUpdate(tap('ja:555'));
      await service.handleUpdate(tap('es:30:555'));
      expect((members.get('555') as { expiresOn: Date }).expiresOn.toISOString().slice(0, 10)).toBe('2026-11-26');
      expect(telegramNotificationService.answerCallback).toHaveBeenLastCalledWith('cb1', '📅 Nok @nok_99 หมดอายุ 26/11/2026');
      expect(telegramNotificationService.sendUnchecked).toHaveBeenLastCalledWith('555', '📅 สิทธิ์รับการแจ้งเตือนของคุณใช้ได้ถึงวันที่ 26/11/2026');

      await service.handleUpdate(tap('es:0:555'));
      expect((members.get('555') as { expiresOn: Date | null }).expiresOn).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the owner type the expiry date, rejecting bad or past dates', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-27T05:00:00Z'), toFake: ['Date'] });
    try {
      const service = new TelegramCommandService();
      await service.handleUpdate(join('/start secret-code-1'));
      await service.handleUpdate(tap('ja:555'));
      await service.handleUpdate(tap('ec:555'));
      expect(vi.mocked(telegramNotificationService.editMenu).mock.calls.at(-1)![2]).toContain('✏️ พิมพ์วันหมดอายุของ Nok @nok_99');

      await service.handleUpdate(update('พรุ่งนี้'));
      expect(telegramNotificationService.reply).toHaveBeenLastCalledWith('123', expect.stringContaining('อ่านวันที่ไม่ออก'));
      await service.handleUpdate(update('01/10/2026'));
      expect(telegramNotificationService.reply).toHaveBeenLastCalledWith('123', expect.stringContaining('ผ่านมาแล้ว'));
      expect((members.get('555') as { expiresOn?: Date }).expiresOn).toBeUndefined();

      await service.handleUpdate(update('31/12/2569'));
      expect((members.get('555') as { expiresOn: Date }).expiresOn.toISOString().slice(0, 10)).toBe('2026-12-31');
      expect(telegramNotificationService.reply).toHaveBeenLastCalledWith('123', '✅ 📅 Nok @nok_99 หมดอายุ 31/12/2026');

      // No longer waiting: plain text is ignored again.
      vi.mocked(telegramNotificationService.reply).mockClear();
      await service.handleUpdate(update('15/01/2027'));
      expect(telegramNotificationService.reply).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows each member\'s expiry in /members with a 📅 button', async () => {
    members.set('555', { chatId: '555', name: 'Nok', username: null, joinedAt: new Date('2026-10-26T05:00:00Z'), approved: true, expiresOn: new Date('2026-12-31T00:00:00Z') });
    const service = new TelegramCommandService();
    await service.handleUpdate(update('/members'));
    const [, text, keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls.at(-1)!;
    expect(text).toContain('หมดอายุ 31/12/2026');
    expect(keyboard.flat()).toContainEqual({ text: '📅', callback_data: 'ex:555' });
  });

  it('rejecting drops the request and tells them politely', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(join('/start secret-code-1'));
    await service.handleUpdate(tap('jr:555'));
    expect(members.has('555')).toBe(false);
    expect(telegramNotificationService.sendUnchecked).toHaveBeenLastCalledWith('555', '🙏 คำขอเข้าร่วมไม่ได้รับอนุมัติ');
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '❌ ปฏิเสธ Nok @nok_99 แล้ว');
  });

  it('lists pending requests in /members with approve / reject buttons', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(join('/start secret-code-1'));
    await service.handleUpdate(update('/members'));
    const [, text, keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls.at(-1)!;
    expect(text).toContain('⏳ รออนุมัติ: 1 คน\n   • Nok @nok_99');
    expect(text).toContain('🙋 สมาชิกที่เข้าผ่านลิงก์: 0 คน');
    expect(keyboard[0]).toEqual([
      { text: '✅ อนุมัติ: Nok @nok_99', callback_data: 'ja:555' },
      { text: '❌ ปฏิเสธ', callback_data: 'jr:555' },
    ]);
  });

  it('does not let a member approve requests', async () => {
    const service = new TelegramCommandService();
    members.set('777', { chatId: '777', name: 'Ann', username: null, joinedAt: new Date() });
    await service.handleUpdate(join('/start secret-code-1'));
    await service.handleUpdate(tap('ja:555', 777));
    expect(members.get('555')).toMatchObject({ approved: false });
    expect(telegramNotificationService.answerCallback).toHaveBeenLastCalledWith('cb1', '🔒 สำหรับเจ้าของบอทเท่านั้น');
  });

  it.each(['/start', '/start wrong-code-xx', '/start SECRET-CODE-1'])('refuses %s without saving anything', async (text) => {
    await new TelegramCommandService().handleUpdate(join(text));
    expect(members.size).toBe(0);
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('ลิงก์เชิญ'));
  });

  it('lets members use menus and alerts but not admin commands', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(join('/start secret-code-1'));
    await service.handleUpdate(tap('ja:555')); // owner approves
    vi.clearAllMocks();
    await service.handleUpdate(join('/menu'));
    expect(vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]![2].flat().map((b) => b.callback_data)).toEqual(['s', 'a', 'h']);
    for (const text of ['/status', 'สถานะ']) {
      await service.handleUpdate(join(text));
      expect(telegramNotificationService.reply).toHaveBeenLastCalledWith('555', '🔒 คำสั่งนี้ใช้ได้เฉพาะเจ้าของบอท');
    }
    expect(readStatus).not.toHaveBeenCalled();
    await service.handleUpdate(tap('st', 555));
    expect(telegramNotificationService.answerCallback).toHaveBeenLastCalledWith('cb1', '🔒 สำหรับเจ้าของบอทเท่านั้น');
    expect(telegramNotificationService.editMenu).not.toHaveBeenCalled();
    await service.handleUpdate(join('/pause'));
    expect(stockScheduler.stop).not.toHaveBeenCalled();
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('555', '🔒 คำสั่งนี้ใช้ได้เฉพาะเจ้าของบอท');
    await service.handleUpdate(tap('sl', 555));
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '🔒 สำหรับเจ้าของบอทเท่านั้น');
  });

  it('shows a member that pressing Start again is fine', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(join('/start secret-code-1'));
    await service.handleUpdate(tap('ja:555')); // owner approves
    await service.handleUpdate(join('/start'));
    expect(vi.mocked(telegramNotificationService.sendMenu).mock.calls.at(-1)![1]).toContain('✅ คุณรับการแจ้งเตือนอยู่แล้ว');
    expect(members.size).toBe(1);
  });

  it('lets a member leave', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(join('/start secret-code-1'));
    await service.handleUpdate(tap('ja:555')); // owner approves
    await service.handleUpdate(join('/leave'));
    expect(members.size).toBe(0);
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('เลิกรับการแจ้งเตือนแล้ว'));
  });

  it('/members lists members (no invite link) and removes one on tap', async () => {
    const { service, preferences } = fakes();
    await service.handleUpdate(join('/start secret-code-1'));
    await service.handleUpdate(tap('ja:555')); // owner approves
    await service.handleUpdate(update('/members'));
    const [, text, keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls.at(-1)!;
    expect(text).toContain('👥 สมาชิก');
    expect(text).toContain('• Nok @nok_99');
    expect(text).not.toContain('https://t.me');
    expect(keyboard.flat()).toContainEqual({ text: '🔗 ส่งคำเชิญ', callback_data: 'inv' });
    expect(keyboard.flat()).toContainEqual({ text: '❌ นำออก: Nok @nok_99', callback_data: 'sx:555' });

    await service.handleUpdate(tap('sx:555'));
    expect(members.size).toBe(0);
    expect(preferences.unmuteAll).toHaveBeenCalledWith('555');
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('ถูกนำออก'));
  });

  it('/invite sends the link, then a message to forward to the invitee', async () => {
    pausedModels.set('iPhone 18 Pro Max', new Date());
    await new TelegramCommandService().handleUpdate(update('/invite'));
    const sent = vi.mocked(telegramNotificationService.reply).mock.calls.map(([chat, text]) => [chat, text]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(['123', '🔗 ลิงก์เชิญ — ส่งให้คนที่อยากรับแจ้งเตือน\nhttps://t.me/duo_stock_bot?start=secret-code-1\n\n👇 หรือกดส่งต่อ (Forward) ข้อความด้านล่างได้เลย']);
    expect(sent[1]![1]).toContain('🍎 ชวนมารับแจ้งเตือน iPhone เข้าสต็อก!');
    expect(sent[1]![1]).not.toMatch(/iPhone Duo|Pro Max|รุ่นที่เฝ้า/); // a forwarded invite names no model
    expect(sent[1]![1]).toContain('👇 กดลิงก์นี้ แล้วกด Start ได้เลย\nhttps://t.me/duo_stock_bot?start=secret-code-1');
  });

  it('the 🔗 button sends the invite as new messages, owner only', async () => {
    await new TelegramCommandService().handleUpdate(tap('inv'));
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '🔗 ส่งคำเชิญให้แล้ว 👇');
    expect(telegramNotificationService.reply).toHaveBeenCalledTimes(2);
    expect(telegramNotificationService.editMenu).not.toHaveBeenCalled();

    vi.clearAllMocks();
    members.set('555', { chatId: '555', name: 'Nok', username: null, joinedAt: new Date() });
    await new TelegramCommandService().handleUpdate(update('/invite', 555));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('555', '🔒 คำสั่งนี้ใช้ได้เฉพาะเจ้าของบอท');
  });

  it('records a group by its title', async () => {
    await new TelegramCommandService().handleUpdate(join('/start@duo_stock_bot secret-code-1', -100777, { type: 'supergroup', title: 'ทีมล่า iPhone' }));
    expect(members.get('-100777')).toMatchObject({ name: 'ทีมล่า iPhone', username: null });
  });
});

describe('Pausing one model (owner only)', () => {
  it('lists models and pauses / resumes one with a tap', async () => {
    const { service } = fakes();
    await service.handleUpdate(update('/models'));
    const [, text, keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]!;
    expect(text).toContain('📱 iPhone 18 Pro Max\n   ▶️ กำลังเช็คตามปกติ');
    expect(buttons(keyboard)).toContainEqual({ text: '⏸️ หยุดเช็ค iPhone 18 Pro Max', callback_data: 'mp:1' });

    await service.handleUpdate(tap('mp:1'));
    expect([...pausedModels.keys()]).toEqual(['iPhone 18 Pro Max']);
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '⏸️ หยุดเช็ค iPhone 18 Pro Max แล้ว');
    expect(lastEdit()[2]).toContain('⏸️ หยุดเช็คอยู่ (ตั้งแต่ 26/10 20:40 น.)');
    expect(buttons(lastEdit()[3])).toContainEqual({ text: '▶️ เริ่มเช็ค iPhone 18 Pro Max', callback_data: 'mp:1' });

    await service.handleUpdate(tap('mp:1'));
    expect(pausedModels.size).toBe(0);
  });

  it('shows a paused model as paused in /stock instead of stale data', async () => {
    const { service } = fakes();
    pausedModels.set('iPhone 18 Pro Max', new Date());
    await service.handleUpdate(update('/stock'));
    const [, text] = vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]!;
    expect(text).toContain('📱 iPhone 18 Pro Max\n⏸️ หยุดเช็ครุ่นนี้ชั่วคราว');
    expect(text).not.toContain('เบอร์กันดี');
    expect(text).toContain('🟢 ไนท์สกาย 256GB');
  });

  it('mentions paused models in the owner status', async () => {
    pausedModels.set('iPhone Duo', new Date());
    await new TelegramCommandService().handleUpdate(update('/status'));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('⏸️ หยุดเช็คอยู่: iPhone Duo'));
  });

  it('never lets a member learn about a paused model, from any message, toast or old button', async () => {
    const { service } = fakes();
    pausedModels.set('iPhone 18 Pro Max', new Date());

    // A brand-new member joins while Pro Max is paused...
    await service.handleUpdate({ update_id: 1, message: { text: '/start secret-code-1', chat: { id: 555, first_name: 'Nok' } } });
    await service.handleUpdate(tap('ja:555')); // owner approves
    // ...uses every command...
    for (const text of ['/menu', '/stock', 'สต็อก', '/alerts', '/history', 'สถิติ', '/status', '/models', '/invite', '/members']) {
      await service.handleUpdate(update(text, 555));
    }
    // ...taps every screen, plus buttons for Pro Max left over from before the pause.
    for (const data of ['m', 's', 'sa', 'a', 'h', 'st', 'mo', 'sl', 'inv',
      'sm:iPhone 18 Pro Max', 'am:iPhone 18 Pro Max', 'av:iPhone 18 Pro Max:0', 'avoff:iPhone 18 Pro Max',
      'avon:iPhone 18 Pro Max', 'hm:iPhone 18 Pro Max', 'hv:v4', 'hv:v5', 'mp:1']) {
      await service.handleUpdate(tap(data, 555));
    }

    const svc = vi.mocked(telegramNotificationService);
    const seenByMember = JSON.stringify([
      ...svc.sendMenu.mock.calls.filter(([chat]) => chat === '555'),
      ...svc.editMenu.mock.calls.filter(([chat]) => chat === '555'),
      ...svc.reply.mock.calls.filter(([chat]) => chat === '555'),
      ...svc.sendUnchecked.mock.calls.filter(([chat]) => chat === '555'),
      ...svc.answerCallback.mock.calls, // toasts
    ]);
    expect(seenByMember).not.toMatch(/Pro Max|เบอร์กันดี|หยุดเช็ค|⏸️/);
    expect(seenByMember).toContain('ไนท์สกาย'); // the member does see the Duo
    expect(pausedModels.has('iPhone 18 Pro Max')).toBe(true); // and cannot un-pause it
  });

  it('still shows the paused model to the owner', async () => {
    const { service } = fakes();
    pausedModels.set('iPhone 18 Pro Max', new Date());
    await service.handleUpdate(update('/alerts'));
    expect(vi.mocked(telegramNotificationService.sendMenu).mock.calls[0]![1]).toContain('📱 iPhone 18 Pro Max');
    await service.handleUpdate(tap('s'));
    expect(buttons(lastEdit()[3])).toContainEqual({ text: '⏸️ iPhone 18 Pro Max (หยุดเช็คอยู่)', callback_data: 'sm:iPhone 18 Pro Max' });
  });

  it('does not let members pause models', async () => {
    const { service } = fakes();
    members.set('555', { chatId: '555', name: 'Nok', username: null, joinedAt: new Date() });
    await service.handleUpdate(update('/models', 555));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('555', '🔒 คำสั่งนี้ใช้ได้เฉพาะเจ้าของบอท');
    await service.handleUpdate(tap('mp:0', 555));
    expect(pausedModels.size).toBe(0);
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', '🔒 สำหรับเจ้าของบอทเท่านั้น');
  });
});

describe('Telegram news to members', () => {
  const addMember = (chatId: string, name: string) =>
    members.set(chatId, { chatId, name, username: null, joinedAt: new Date('2026-10-26T05:00:00Z'), approved: true });

  it('asks for the text, previews it, and sends only after confirming', async () => {
    addMember('555', 'Nok');
    addMember('556', 'Ploy');
    members.set('557', { chatId: '557', name: 'Wait', username: null, joinedAt: new Date(), approved: false });
    const service = new TelegramCommandService();

    await service.handleUpdate(update('/news'));
    expect(vi.mocked(telegramNotificationService.sendMenu).mock.calls.at(-1)![1]).toContain('จะส่งถึงสมาชิก 2 คน');

    await service.handleUpdate(update('พรุ่งนี้ร้านปิด\nเจอกันวันจันทร์'));
    const [, preview, keyboard] = vi.mocked(telegramNotificationService.sendMenu).mock.calls.at(-1)!;
    expect(preview).toContain('📢 ข่าวจากแอดมิน\n\nพรุ่งนี้ร้านปิด\nเจอกันวันจันทร์');
    expect(buttons(keyboard)).toContainEqual({ text: '✅ ส่งเลย (2 คน)', callback_data: 'nws' });
    expect(telegramNotificationService.sendUnchecked).not.toHaveBeenCalled();

    await service.handleUpdate(tap('nws'));
    const sentTo = vi.mocked(telegramNotificationService.sendUnchecked).mock.calls.map(([chat]) => chat);
    expect(sentTo).toEqual(['555', '556']);
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', '📢 ข่าวจากแอดมิน\n\nพรุ่งนี้ร้านปิด\nเจอกันวันจันทร์');
    expect(lastEdit()[2]).toContain('ส่งข้อความถึงสมาชิกแล้ว 2 คน');

    // A second tap on the same preview does not send again.
    await service.handleUpdate(tap('nws'));
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledTimes(2);
  });

  it('takes the text inline and reports members it could not reach', async () => {
    addMember('555', 'Nok');
    addMember('556', 'Ploy');
    vi.mocked(telegramNotificationService.sendUnchecked).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const service = new TelegramCommandService();
    await service.handleUpdate(update('/news ของเข้าเยอะมากวันนี้'));
    expect(vi.mocked(telegramNotificationService.sendMenu).mock.calls.at(-1)![1]).toContain('ของเข้าเยอะมากวันนี้');
    await service.handleUpdate(tap('nws'));
    expect(lastEdit()[2]).toContain('ส่งไม่ถึง 1 คน: Ploy');
  });

  it('cancel drops the draft and plain text is ignored again', async () => {
    addMember('555', 'Nok');
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('nw'));
    await service.handleUpdate(tap('nwx'));
    vi.mocked(telegramNotificationService.sendMenu).mockClear();
    await service.handleUpdate(update('hello'));
    expect(telegramNotificationService.sendMenu).not.toHaveBeenCalled();
    await service.handleUpdate(tap('nws'));
    expect(telegramNotificationService.sendUnchecked).not.toHaveBeenCalled();
  });

  it('is owner-only', async () => {
    addMember('555', 'Nok');
    const service = new TelegramCommandService();
    await service.handleUpdate(update('/news hi all', 555));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('555', '🔒 คำสั่งนี้ใช้ได้เฉพาะเจ้าของบอท');
    await service.handleUpdate(tap('nws', 555));
    expect(telegramNotificationService.sendUnchecked).not.toHaveBeenCalled();
  });
});

describe('payment receipts', () => {
  const receipt = { update_id: 101, message: { message_id: 42, chat: { id: 555 }, photo: [{ file_id: 'receipt' }] } };
  it('relays pending receipts with approval controls without approving payment', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(update('/start secret-code-1', 555));
    vi.clearAllMocks();
    await service.handleUpdate(receipt);
    expect(telegramNotificationService.copyReceipt).toHaveBeenCalledWith('123', '555', 42);
    expect(telegramNotificationService.sendMenu).toHaveBeenCalledWith('123', expect.stringContaining('555'), [[
      { text: '✅ อนุมัติ', callback_data: 'ja:555' },
      { text: '❌ ปฏิเสธ', callback_data: 'jr:555' },
    ]]);
    expect(members.get('555')).toMatchObject({ approved: false });
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('ส่งสลิปให้เจ้าของบอทแล้ว'));
  });
  it('does not relay receipts from someone without an invitation', async () => {
    await new TelegramCommandService().handleUpdate(receipt);
    expect(telegramNotificationService.copyReceipt).not.toHaveBeenCalled();
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('ลิงก์เชิญ'));
  });
  it('asks to resend when copying fails', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(update('/start secret-code-1', 555));
    vi.mocked(telegramNotificationService.copyReceipt).mockResolvedValueOnce(false);
    await service.handleUpdate(receipt);
    expect(telegramNotificationService.sendUnchecked).toHaveBeenLastCalledWith('555', expect.stringContaining('ไม่สำเร็จ'));
  });
});

describe('membership price menu', () => {
  it('lets the owner save a price and includes the amount in join instructions', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('fee'));
    expect(lastEdit()[2]).toContain('ยังไม่ได้ตั้งราคา');
    await service.handleUpdate(update('199.50'));
    expect(membershipSettings.setPrice).toHaveBeenCalledWith(19950);
    vi.mocked(membershipSettings.price).mockResolvedValue(19950);
    await service.handleUpdate(update('/start secret-code-1', 555));
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('ยอดชำระ: 199.50 บาท'));
  });
  it('rejects invalid amounts and allows correcting the input', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('fee'));
    for (const text of ['-1', 'abc', '1.999', '1000000']) await service.handleUpdate(update(text));
    expect(membershipSettings.setPrice).not.toHaveBeenCalled();
    await service.handleUpdate(update('250'));
    expect(membershipSettings.setPrice).toHaveBeenCalledWith(25000);
  });
  it('blocks members from changing the price even through forged callbacks', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(update('/start secret-code-1', 555));
    await service.handleUpdate(tap('ja:555'));
    await service.handleUpdate(tap('fee', 555));
    await service.handleUpdate(update('10', 555));
    expect(membershipSettings.setPrice).not.toHaveBeenCalled();
    expect(telegramNotificationService.answerCallback).toHaveBeenCalledWith('cb1', expect.stringContaining('เจ้าของบอท'));
  });
  it('cancels price entry through /menu', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('fee'));
    await service.handleUpdate(update('/menu'));
    await service.handleUpdate(update('199'));
    expect(membershipSettings.setPrice).not.toHaveBeenCalled();
  });
  it('keeps entry available after a failed save', async () => {
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('fee'));
    vi.mocked(membershipSettings.setPrice).mockRejectedValueOnce(new Error('db down'));
    await service.handleUpdate(update('199'));
    expect(telegramNotificationService.reply).toHaveBeenLastCalledWith('123', expect.stringContaining('ไม่สำเร็จ'));
    await service.handleUpdate(update('299'));
    expect(membershipSettings.setPrice).toHaveBeenLastCalledWith(29900);
  });
});

describe('priced QR instructions', () => {
  it('includes the configured amount in the QR caption', async () => {
    vi.mocked(membershipSettings.price).mockResolvedValue(29900);
    env.TELEGRAM_PAYMENT_QR_PATH = 'assets/payment-qr.jpg';
    try {
      await new TelegramCommandService().handleUpdate(update('/start secret-code-1', 555));
      expect(telegramNotificationService.sendPaymentQr).toHaveBeenCalledWith('555', expect.stringContaining('ยอดชำระ: 299.00 บาท'));
    } finally {
      env.TELEGRAM_PAYMENT_QR_PATH = '';
    }
  });
});

describe('direct messages to individual members', () => {
  const add = (id: string, approved = true) => members.set(id, { chatId: id, name: `Member ${id}`, username: null, joinedAt: new Date(), approved });
  const confirm = () => buttons(vi.mocked(telegramNotificationService.sendMenu).mock.calls.at(-1)![2]).find((b) => b.callback_data.startsWith('dms:'))!.callback_data;

  it('previews then sends only to the chosen member, once', async () => {
    add('555'); add('666');
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('dml:0'));
    expect(lastEdit()[2]).toContain('เลือกสมาชิก');
    await service.handleUpdate(tap('dm:555'));
    await service.handleUpdate(update('สวัสดีครับ'));
    expect(telegramNotificationService.sendUnchecked).not.toHaveBeenCalled();
    const data = confirm();
    await service.handleUpdate(tap(data));
    await service.handleUpdate(tap(data));
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledTimes(1);
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', '💬 ข้อความจากเจ้าของบอท\n\nสวัสดีครับ');
  });

  it('invalidates the previous preview after editing', async () => {
    add('555');
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('dm:555'));
    await service.handleUpdate(update('ข้อความเก่า'));
    const stale = confirm();
    await service.handleUpdate(update('ข้อความใหม่'));
    const fresh = confirm();
    await service.handleUpdate(tap(stale));
    expect(telegramNotificationService.sendUnchecked).not.toHaveBeenCalled();
    await service.handleUpdate(tap(fresh));
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('ข้อความใหม่'));
  });

  it.each(['dmx', 'm', '/menu'])('cancels composing with %s', async (cancel) => {
    add('555');
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('dm:555'));
    await service.handleUpdate(update('draft'));
    const data = confirm();
    await service.handleUpdate(cancel.startsWith('/') ? update(cancel) : tap(cancel));
    await service.handleUpdate(tap(data));
    expect(telegramNotificationService.sendUnchecked).not.toHaveBeenCalled();
  });

  it('does not send after a member is removed', async () => {
    add('555');
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('dm:555'));
    await service.handleUpdate(update('draft'));
    const data = confirm();
    members.delete('555');
    await service.handleUpdate(tap(data));
    expect(telegramNotificationService.sendUnchecked).not.toHaveBeenCalled();
    expect(lastEdit()[2]).toContain('ไม่ได้ส่งข้อความ');
  });

  it('rejects forged callbacks from members', async () => {
    add('555'); add('666');
    const service = new TelegramCommandService();
    for (const action of ['dml:0', 'dm:666', 'dms:fake', 'dmx']) await service.handleUpdate(tap(action, 555));
    expect(telegramNotificationService.sendUnchecked).not.toHaveBeenCalled();
    expect(telegramNotificationService.answerCallback).toHaveBeenLastCalledWith('cb1', expect.stringContaining('เจ้าของบอท'));
  });

  it('does not offer pending requests and paginates the members', async () => {
    for (let i = 0; i < 10; i++) add(String(500 + i));
    add('999', false);
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('dml:0'));
    expect(buttons(lastEdit()[3]).filter((b) => b.callback_data.startsWith('dm:'))).toHaveLength(8);
    await service.handleUpdate(tap('dml:1'));
    const choices = buttons(lastEdit()[3]).filter((b) => b.callback_data.startsWith('dm:'));
    expect(choices.map((b) => b.callback_data)).toEqual(['dm:508', 'dm:509']);
    await service.handleUpdate(tap('dm:999'));
    expect(lastEdit()[2]).toContain('เลือกสมาชิก');
  });

  it('reports delivery failure and requires a new confirmation to retry', async () => {
    add('555');
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('dm:555'));
    await service.handleUpdate(update('draft'));
    vi.mocked(telegramNotificationService.sendUnchecked).mockResolvedValueOnce(false);
    const data = confirm();
    await service.handleUpdate(tap(data));
    expect(lastEdit()[2]).toContain('ไม่สำเร็จ');
    await service.handleUpdate(tap(data));
    expect(telegramNotificationService.sendUnchecked).toHaveBeenCalledTimes(1);
  });

  it('invalidates the preview when replacement text is too long', async () => {
    add('555');
    const service = new TelegramCommandService();
    await service.handleUpdate(tap('dm:555'));
    await service.handleUpdate(update('draft'));
    const data = confirm();
    await service.handleUpdate(update('x'.repeat(3801)));
    await service.handleUpdate(tap(data));
    expect(telegramNotificationService.sendUnchecked).not.toHaveBeenCalled();
  });
});

describe('renewal receipts', () => {
  it('relays a current member receipt with the expiry editor and does not extend automatically', async () => {
    const expiresOn = new Date('2026-11-01T00:00:00Z');
    members.set('555', { chatId: '555', name: 'Nok', username: null, joinedAt: new Date(), approved: true, expiresOn });
    await new TelegramCommandService().handleUpdate({ update_id: 110, message: {
      message_id: 43, chat: { id: 555 }, document: { file_id: 'receipt-pdf', mime_type: 'application/pdf' },
    } });
    expect(telegramNotificationService.copyReceipt).toHaveBeenCalledWith('123', '555', 43);
    expect(telegramNotificationService.sendMenu).toHaveBeenCalledWith('123', expect.stringContaining('สลิปต่ออายุสมาชิก'), [[
      { text: '📅 ตรวจสลิป / ต่ออายุสมาชิก', callback_data: 'ex:555' },
    ]]);
    expect(members.get('555')).toMatchObject({ expiresOn });
    expect(telegramNotificationService.sendUnchecked).toHaveBeenLastCalledWith('555', expect.stringContaining('อัปเดตวันหมดอายุ'));
  });
});
