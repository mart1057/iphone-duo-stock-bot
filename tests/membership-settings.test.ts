import { describe, expect, it, vi } from 'vitest';
import { MembershipSettingsStore, parseMembershipPrice, formatMembershipPrice } from '../src/notification/membership.settings.js';

describe('membership settings', () => {
  it.each([['199', 19900], ['0', 0], ['12.50', 1250], ['12.5', 1250], ['999999.99', 99999999]])('parses %s exactly into satang', (text, expected) => {
    expect(parseMembershipPrice(text as string)).toBe(expected);
  });
  it.each(['-1', '1e3', 'NaN', '', '1.234', '1000000', '199 บาท'])('rejects %s', (text) => {
    expect(parseMembershipPrice(text)).toBeNull();
  });
  it('formats the member payment amount', () => {
    expect(formatMembershipPrice(19950)).toBe('199.50 บาท');
  });
  it('persists settings across store instances', async () => {
    let row: { priceSatang: number } | null = null;
    const db = { membershipSettings: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async ({ update }: { update: { priceSatang: number } }) => { row = update; }),
    } };
    const first = new MembershipSettingsStore(db as never);
    expect(await first.price()).toBeNull();
    await first.setPrice(19950);
    expect(await new MembershipSettingsStore(db as never).price()).toBe(19950);
    await expect(first.setPrice(-1)).rejects.toThrow('Invalid');
  });
});
