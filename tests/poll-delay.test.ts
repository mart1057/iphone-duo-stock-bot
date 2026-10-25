import { describe, expect, it, vi } from 'vitest';
import { nextPollDelay } from '../src/scheduler/poll-delay.js';
import { AppleClient } from '../src/apple/apple.client.js';
import { RateLimitGuard } from '../src/scheduler/rate-limit.guard.js';

describe('random polling', () => {
  it('samples every delay from 25 through 45 seconds', () => {
    const random = vi.spyOn(Math, 'random');
    try {
      for (let offset = 0; offset <= 20; offset++) {
        random.mockReturnValue((offset + 0.5) / 21);
        expect(nextPollDelay()).toBe(25 + offset);
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
