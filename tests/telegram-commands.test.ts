import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  env: { telegramChatIds: ['123'], TELEGRAM_DRY_RUN: false },
  isTelegramConfigured: () => true,
}));
vi.mock('../src/scheduler/stock.scheduler.js', () => ({
  stockScheduler: { getStatusText: () => '🔎 กำลังตรวจสต็อก', start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/notification/status.report.js', () => ({
  readStatus: vi.fn().mockResolvedValue({}),
  buildStatusMessage: () => ({ text: 'ตรวจล่าสุด: วันนี้' }),
}));
vi.mock('../src/notification/telegram.service.js', () => ({
  telegramNotificationService: { reply: vi.fn().mockResolvedValue(true) },
}));
import { TelegramCommandService } from '../src/notification/telegram.commands.js';
import { telegramNotificationService } from '../src/notification/telegram.service.js';
import { stockScheduler } from '../src/scheduler/stock.scheduler.js';
import { readStatus } from '../src/notification/status.report.js';

const update = (text: string, id = 123) => ({
  update_id: 1, message: { text, chat: { id } },
});

beforeEach(() => vi.clearAllMocks());

describe('Telegram status commands', () => {
  it.each(['/status', '/status@my_bot', 'สถานะ', 'เช็คสถานะ', 'สถานะการเช็ค'])('answers %s in the requesting chat', async (text) => {
    await new TelegramCommandService().handleUpdate(update(text));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('กำลังตรวจสต็อก'));
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('ตรวจล่าสุด: วันนี้'));
  });

  it.each(['/stop', '/stop@my_bot', '/start', '/start@my_bot'])('controls checks with %s', async (text) => {
    await new TelegramCommandService().handleUpdate(update(text));
    expect(text.startsWith('/stop') ? stockScheduler.stop : stockScheduler.start).toHaveBeenCalledTimes(1);
    expect(readStatus).not.toHaveBeenCalled();
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.any(String));
  });

  it('rejects control commands from unauthorized chats', async () => {
    await new TelegramCommandService().handleUpdate(update('/stop', 999));
    await new TelegramCommandService().handleUpdate(update('/start', 999));
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
    expect(telegramNotificationService.reply).toHaveBeenCalledWith('123', expect.stringContaining('อ่านผลตรวจล่าสุดไม่ได้'));
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
