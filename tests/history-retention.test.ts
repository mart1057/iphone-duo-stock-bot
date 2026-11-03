import { afterEach, describe, expect, it, vi } from 'vitest';
import { pruneHistory } from '../src/database/history.retention.js';
import { HistoryScheduler } from '../src/scheduler/history.scheduler.js';

afterEach(() => vi.useRealTimers());

describe('history retention', () => {
  it('keeps restock edges for the restock window and UNKNOWN rows for 72 hours', async () => {
    const now = new Date('2026-09-20T03:00:00Z');
    const cutoff = new Date('2026-09-17T03:00:00Z');
    const restockCutoff = new Date('2026-08-21T03:00:00Z'); // 30 days
    const row = (checkedAt: Date, status: string) => ({ checkedAt, status });
    let history = [
      row(new Date(cutoff.getTime() - 1), 'UNKNOWN'),
      row(new Date(cutoff.getTime() - 1), 'AVAILABLE'),
      row(new Date(restockCutoff.getTime() - 1), 'UNAVAILABLE'),
      row(cutoff, 'UNKNOWN'),
      row(now, 'AVAILABLE'),
    ];
    const dates = [new Date(cutoff.getTime() - 1), cutoff, now];
    let notifications = [...dates];
    const stock = { deleteMany: vi.fn(), update: vi.fn() };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      stock,
      stockHistory: { deleteMany: vi.fn(async ({ where }) => {
        const before = history.length;
        history = history.filter(item =>
          !(item.checkedAt < where.checkedAt.lt && (!where.status || item.status === where.status)));
        return { count: before - history.length };
      }) },
      notificationLog: { deleteMany: vi.fn(async ({ where }) => {
        const before = notifications.length;
        notifications = notifications.filter(date => !(date < where.sentAt.lt));
        return { count: before - notifications.length };
      }) },
    };
    const db = { $transaction: vi.fn(async (run) => run(tx)) };
    expect(await pruneHistory(now, db as never, 30)).toEqual({ cutoff, restockCutoff, history: 2, notifications: 1 });
    expect(history.map(item => item.status)).toEqual(['AVAILABLE', 'UNKNOWN', 'AVAILABLE']);
    expect(notifications).toEqual([cutoff, now]);
    expect(stock.deleteMany).not.toHaveBeenCalled();
    expect(stock.update).not.toHaveBeenCalled();
  });

  it('keeps restock history for 6 months by default', async () => {
    const now = new Date('2026-10-26T00:00:00Z');
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      stockHistory: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      notificationLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const db = { $transaction: vi.fn(async (run) => run(tx)) };
    const result = await pruneHistory(now, db as never);
    expect(result.restockCutoff).toEqual(new Date('2026-04-29T00:00:00Z')); // 180 days
  });

  it('continues its daily schedule after failure and stops cleanly', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn()
      .mockRejectedValueOnce(new Error('DB unavailable'))
      .mockResolvedValue({ cutoff: new Date(), history: 0, notifications: 0 });
    const scheduler = new HistoryScheduler(cleanup);
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(cleanup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(cleanup).toHaveBeenCalledTimes(2);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('does not overlap a running cleanup and waits for it on shutdown', async () => {
    vi.useFakeTimers();
    let release!: (result: Awaited<ReturnType<typeof pruneHistory>>) => void;
    const cleanup = vi.fn(() => new Promise<Awaited<ReturnType<typeof pruneHistory>>>(resolve => {
      release = resolve;
    }));
    const scheduler = new HistoryScheduler(cleanup);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(cleanup).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release({ cutoff: new Date(), history: 0, notifications: 0 });
    await stopping;
    expect(vi.getTimerCount()).toBe(0);
  });
});
