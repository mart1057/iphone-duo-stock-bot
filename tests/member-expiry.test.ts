import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  env: { telegramChatIds: ['123'], MEMBER_EXPIRY_CHECK_HOUR: 9 },
}));
vi.mock('../src/notification/telegram.service.js', () => ({ telegramNotificationService: {} }));
vi.mock('../src/notification/telegram.preferences.js', () => ({ telegramAlertPreferences: {} }));
vi.mock('../src/notification/telegram.recipients.js', () => ({ telegramRecipients: {} }));

import { MemberExpiryService } from '../src/notification/member.expiry.js';
import { parseDateInput } from '../src/utils/datetime.js';

const member = (chatId: string, name: string, expires: string) => ({
  chatId, name, username: null, joinedAt: new Date('2026-10-01T00:00:00Z'), approved: true,
  expiresOn: new Date(`${expires}T00:00:00Z`),
});

const setup = (now: string) => {
  const list = [member('555', 'Nok', '2026-10-27'), member('666', 'Ton', '2026-10-28')];
  const recipients = {
    subscribers: vi.fn(async () => list),
    isAdmin: (id: string) => id === '123',
    expiredBy: vi.fn(async (today: string) => list.filter((m) => m.expiresOn && m.expiresOn.toISOString().slice(0, 10) <= today)),
    remove: vi.fn(async (chatId: string) => {
      const index = list.findIndex((m) => m.chatId === chatId);
      if (index < 0) return false;
      list.splice(index, 1);
      return true;
    }),
  };
  const preferences = { unmuteAll: vi.fn(async () => undefined) };
  const telegram = { sendPaymentQr: vi.fn(async () => true), sendUnchecked: vi.fn(async () => true), clearCommands: vi.fn(async () => true) };
  const sent = new Set<string>();
  const reminders = {
    claim: vi.fn(async (chat: string, expiry: string) => sent.has(`${chat}:${expiry}`) ? null : new Date('2026-10-27T03:00:00Z')),
    complete: vi.fn(async (chat: string, expiry: string) => { sent.add(`${chat}:${expiry}`); }),
    release: vi.fn(async () => undefined),
  };
  const membership = { price: vi.fn(async () => 19900) };
  const makeService = (time = now) => new MemberExpiryService(recipients as never, preferences as never, telegram, () => new Date(time), reminders as never, membership as never);
  const service = makeService();
  return { service, recipients, telegram, list, reminders, membership, makeService };

};

describe('member expiry', () => {
  it('waits for the check hour (Bangkok time)', async () => {
    const { service, recipients } = setup('2026-10-27T01:00:00Z'); // 08:00 BKK
    expect(await service.run()).toEqual([]);
    expect(recipients.expiredBy).not.toHaveBeenCalled();
  });

  it('removes members expiring today, tells them, and reports once to admins', async () => {
    const { service, telegram, list } = setup('2026-10-27T02:30:00Z'); // 09:30 BKK
    const expired = await service.run();
    expect(expired.map((m) => m.chatId)).toEqual(['555']);
    expect(list.map((m) => m.chatId)).toEqual(['666']);
    expect(telegram.clearCommands).toHaveBeenCalledWith('555');
    expect(telegram.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('หมดอายุแล้ว'));
    const report = telegram.sendUnchecked.mock.calls.find(([chat]) => chat === '123')!;
    expect(report[1]).toContain('⌛ สมาชิกหมดอายุวันนี้ (27/10/2026): 1 คน');
    expect(report[1]).toContain('• Nok (หมดอายุ 27/10/2026)');

    telegram.sendUnchecked.mockClear();
    expect(await service.run()).toEqual([]);
    expect(telegram.sendUnchecked).not.toHaveBeenCalled();
  });

  it('sends a reminder with QR and amount the day before expiry without removing anyone', async () => {
    const { service, telegram, recipients } = setup('2026-10-26T05:00:00Z');
    await service.run();
    expect(telegram.sendPaymentQr).toHaveBeenCalledWith('555', expect.stringContaining('27/10/2026 เวลา 09:00'));
    expect(telegram.sendPaymentQr).toHaveBeenCalledWith('555', expect.stringContaining('199.00 บาท'));
    expect(telegram.sendPaymentQr).toHaveBeenCalledWith('555', expect.stringContaining('ส่งรูปสลิป ในแชตนี้'));
    expect(telegram.sendUnchecked).not.toHaveBeenCalled();
    expect(recipients.remove).not.toHaveBeenCalled();
  });
});

describe('renewal reminders', () => {
  it('does not resend successful reminders after service restart', async () => {
    const { service, makeService, telegram } = setup('2026-10-26T05:00:00Z');
    await service.run();
    await makeService('2026-10-26T06:00:00Z').run();
    expect(telegram.sendPaymentQr).toHaveBeenCalledTimes(1);
  });

  it('falls back to text with accurate QR instructions', async () => {
    const { service, telegram, reminders } = setup('2026-10-26T05:00:00Z');
    telegram.sendPaymentQr.mockResolvedValueOnce(false);
    await service.run();
    expect(telegram.sendUnchecked).toHaveBeenCalledWith('555', expect.stringContaining('ติดต่อเจ้าของบอทเพื่อขอ QR'));
    expect(reminders.complete).toHaveBeenCalledTimes(1);
  });

  it('retries next check when both image and text delivery fail', async () => {
    const { service, telegram, reminders } = setup('2026-10-26T05:00:00Z');
    telegram.sendPaymentQr.mockResolvedValueOnce(false);
    telegram.sendUnchecked.mockResolvedValueOnce(false);
    await service.run();
    expect(reminders.complete).not.toHaveBeenCalled();
    expect(reminders.release).toHaveBeenCalledTimes(1);
    await service.run();
    expect(telegram.sendPaymentQr).toHaveBeenCalledTimes(2);
    expect(reminders.complete).toHaveBeenCalledTimes(1);
  });

  it('skips members without expiry and dates more than one day away', async () => {
    const { service, list, telegram } = setup('2026-10-25T05:00:00Z');
    list.push({ ...list[0]!, chatId: '777', expiresOn: null as never });
    await service.run();
    expect(telegram.sendPaymentQr).not.toHaveBeenCalled();
  });

  it('reminds again for a newly extended expiry date', async () => {
    const { service, makeService, list, telegram } = setup('2026-10-26T05:00:00Z');
    await service.run();
    list[0]!.expiresOn = new Date('2026-11-27T00:00:00Z');
    await makeService('2026-11-26T05:00:00Z').run();
    expect(telegram.sendPaymentQr).toHaveBeenCalledTimes(2);
    expect(telegram.sendPaymentQr).toHaveBeenLastCalledWith('555', expect.stringContaining('27/11/2026'));
  });

  it('does not send a payment amount when reading price fails', async () => {
    const { service, telegram, membership, reminders } = setup('2026-10-26T05:00:00Z');
    membership.price.mockRejectedValueOnce(new Error('DB unavailable'));
    await service.run();
    expect(telegram.sendPaymentQr).not.toHaveBeenCalled();
    expect(reminders.claim).not.toHaveBeenCalled();
  });
});

describe('parseDateInput', () => {
  const today = '2026-10-27';
  it.each([
    ['31/12/2026', '2026-12-31'],
    ['31-12-2569', '2026-12-31'],
    ['1.2.2027', '2027-02-01'],
    ['2026-12-31', '2026-12-31'],
    ['30', '2026-11-26'],
    ['30 วัน', '2026-11-26'],
  ])('%s -> %s', (input, expected) => expect(parseDateInput(input, today)).toBe(expected));

  it.each(['31/02/2027', 'พรุ่งนี้', '12/2026', ''])('rejects %s', (input) => expect(parseDateInput(input, today)).toBeNull());
});
