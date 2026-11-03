import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
import { readFile } from 'node:fs/promises';
vi.mock('../src/config/env.js', () => ({
  env: { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_DRY_RUN: false, REQUEST_TIMEOUT_MS: 1000, TELEGRAM_PAYMENT_QR_PATH: 'assets/payment-qr.jpg' },
  isTelegramConfigured: () => true,
}));
import { TelegramNotificationService } from '../src/notification/telegram.service.js';

const service = new TelegramNotificationService(undefined, {
  isAdmin: (id: string) => id === '123',
} as never);
afterEach(() => vi.unstubAllGlobals());

describe('receipt delivery', () => {
  it('copies the original receipt to the owner through Telegram', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await service.copyReceipt('123', '555', 42)).toBe(true);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/copyMessage$/);
    expect(JSON.parse(options.body)).toEqual({ chat_id: '123', from_chat_id: '555', message_id: 42 });
  });
  it('does not copy receipts to non-admin recipients', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await service.copyReceipt('999', '555', 42)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reports API failures to allow a truthful retry prompt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 403 })));
    expect(await service.copyReceipt('123', '555', 42)).toBe(false);
  });
});

describe('payment QR delivery', () => {
  it('uploads the configured image with payment instructions', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('image'));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 10 } })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await service.sendPaymentQr('555', 'payment instructions')).toBe(true);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/sendPhoto$/);
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('chat_id')).toBe('555');
    expect(options.body.get('caption')).toBe('payment instructions');
    expect(options.body.get('photo').name).toBe('payment-qr.jpg');
    expect(options.headers).toBeUndefined();
  });
  it('allows text fallback when the QR image is missing', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await service.sendPaymentQr('555', 'instructions')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
