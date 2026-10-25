import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { checkWindow } from '../src/scheduler/check-window.js';
import { StockScheduler } from '../src/scheduler/stock.scheduler.js';
import { AppleClient } from '../src/apple/apple.client.js';

const previous = env.STOCK_CHECK_WINDOW_ENABLED;
beforeEach(() => {
  env.STOCK_CHECK_WINDOW_ENABLED = true;
  vi.useFakeTimers();
});
afterEach(() => {
  env.STOCK_CHECK_WINDOW_ENABLED = previous;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  ['2026-10-25T05:29:59+07:00', false],
  ['2026-10-25T05:30:00+07:00', true],
  ['2026-10-25T21:59:59+07:00', true],
  ['2026-10-25T22:00:00+07:00', false],
  ['2026-10-26T00:00:00+07:00', false],
])('enforces Bangkok window at %s', (time, open) => {
  expect(checkWindow(Date.parse(time)).open).toBe(open);
});

it('does not call Apple at night, even for product catalogue requests', async () => {
  vi.setSystemTime(new Date('2026-10-25T22:00:00+07:00'));
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(new AppleClient().getProductPageHtml()).rejects.toMatchObject({ retryable: false });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('waits overnight and resumes automatically at 05:30 without overlapping', async () => {
  vi.setSystemTime(new Date('2026-10-25T21:59:59+07:00'));
  const stocks = { runCheck: vi.fn().mockResolvedValue({ rateLimited: false, transitions: [] }) };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const repository = { releaseLock: vi.fn().mockResolvedValue(undefined) };
  const scheduler = new StockScheduler(stocks as never, notifications as never, repository as never);
  try {
    await scheduler.start();
    expect(stocks.runCheck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(stocks.runCheck).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatusText()).toContain('05:30');
    await vi.advanceTimersByTimeAsync(7.5 * 60 * 60_000 - 1);
    expect(stocks.runCheck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(stocks.runCheck).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  } finally { await scheduler.stop(); }
});
