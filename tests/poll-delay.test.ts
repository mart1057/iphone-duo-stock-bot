import { describe, expect, it, vi } from 'vitest';
import { nextPollDelay } from '../src/scheduler/poll-delay.js';
import { AppleClient } from '../src/apple/apple.client.js';
import { RateLimitGuard } from '../src/scheduler/rate-limit.guard.js';

describe('scheduled polling', () => {
  it.each([
    ['2026-10-30T05:30:00+07:00', 30],
    ['2026-10-30T07:59:59.999+07:00', 30],
    ['2026-10-30T08:00:00+07:00', 10],
    ['2026-10-30T08:59:59.999+07:00', 10],
    ['2026-10-30T09:00:00+07:00', 30],
    ['2026-10-30T21:59:59+07:00', 30],
    ['2026-10-31T08:00:00+07:00', 10],
  ])('uses Bangkok schedule at %s', (timestamp, expected) => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(nextPollDelay(Date.parse(timestamp))).toBe(expected);
    } finally {
      random.mockRestore();
    }
  });

  it('samples all delays from 10 through 15 during the morning hour', () => {
    const random = vi.spyOn(Math, 'random');
    try {
      for (let offset = 0; offset <= 5; offset++) {
        random.mockReturnValue((offset + 0.5) / 6);
        expect(nextPollDelay(Date.parse('2026-10-30T08:30:00+07:00'))).toBe(10 + offset);
      }
    } finally {
      random.mockRestore();
    }
  });

  it('pauses immediately for 15 minutes, including repeated limits', () => {
    const guard = new RateLimitGuard();
    for (const now of [0, 900_000, 1_800_000]) {
      const entry = guard.recordRateLimited(now)!;
      expect(entry.cooldownMs).toBe(900_000);
      expect(guard.check(now + 899_999).skip).toBe(true);
      expect(guard.check(now + 900_000).skip).toBe(false);
    }
  });

  it.each([403,429,503,541])('does not retry blocked HTTP %s', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(new AppleClient().getPickupMessage(['test'], '10330')).rejects.toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
