import { describe, expect, it, vi } from 'vitest';
import { MembershipReminderStore } from '../src/notification/membership.reminders.js';

const setup = () => {
  let row: { chatId: string; expiresOn: Date; leaseUntil: Date; sentAt: Date | null } | null = null;
  const matches = (where: any) => row && row.chatId === where.chatId
    && +row.expiresOn === +where.expiresOn && row.sentAt === null
    && (where.leaseUntil instanceof Date ? +row.leaseUntil === +where.leaseUntil : +row.leaseUntil <= +where.leaseUntil.lte);
  const db = { membershipReminder: {
    create: vi.fn(async ({ data }: any) => {
      if (row) throw { code: 'P2002' };
      row = { ...data, sentAt: null };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      if (!matches(where)) return { count: 0 };
      row = { ...row!, ...data };
      return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      if (!matches(where)) return { count: 0 };
      row = null;
      return { count: 1 };
    }),
  } };
  return { db, make: () => new MembershipReminderStore(db as never) };
};
const now = new Date('2026-10-31T02:00:00Z');

describe('persistent renewal reminder delivery', () => {
  it('only allows one concurrent sender and remembers successful delivery after restart', async () => {
    const { make } = setup();
    const results = await Promise.all([make().claim('555', '2026-11-01', now), make().claim('555', '2026-11-01', now)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await make().complete('555', '2026-11-01', results.find(Boolean)!, now);
    expect(await make().claim('555', '2026-11-01', new Date(+now + 3600000))).toBeNull();
  });
  it('recovers an abandoned lease after a process crash', async () => {
    const { make } = setup();
    const oldLease = await make().claim('555', '2026-11-01', now);
    expect(await make().claim('555', '2026-11-01', new Date(+now + 60000))).toBeNull();
    const recovered = await make().claim('555', '2026-11-01', new Date(+now + 600000));
    expect(recovered).not.toBeNull();
    // An old sender cannot delete or complete a newer sender's lease.
    await make().release('555', '2026-11-01', oldLease!);
    await make().complete('555', '2026-11-01', oldLease!, now);
    expect(await make().claim('555', '2026-11-01', new Date(+now + 600001))).toBeNull();
    await make().complete('555', '2026-11-01', recovered!, now);
    expect(await make().claim('555', '2026-11-01', new Date(+now + 3600000))).toBeNull();
  });
  it('allows retry after a known delivery failure', async () => {
    const { make } = setup();
    const lease = await make().claim('555', '2026-11-01', now);
    await make().release('555', '2026-11-01', lease!);
    expect(await make().claim('555', '2026-11-01', now)).not.toBeNull();
  });
});
