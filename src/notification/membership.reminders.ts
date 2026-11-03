import type { PrismaClient } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { keyToDbDate } from '../utils/datetime.js';

export class MembershipReminderStore {
  constructor(private readonly db: PrismaClient = prisma) {}

  async claim(chatId: string, expiry: string, now: Date): Promise<Date | null> {
    const expiresOn = keyToDbDate(expiry);
    const leaseUntil = new Date(now.getTime() + 10 * 60_000);
    try {
      await this.db.membershipReminder.create({ data: { chatId, expiresOn, leaseUntil } });
      return leaseUntil;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
    const result = await this.db.membershipReminder.updateMany({
      where: { chatId, expiresOn, sentAt: null, leaseUntil: { lte: now } },
      data: { leaseUntil },
    });
    return result.count ? leaseUntil : null;
  }

  async complete(chatId: string, expiry: string, lease: Date, now: Date): Promise<void> {
    await this.db.membershipReminder.updateMany({
      where: { chatId, expiresOn: keyToDbDate(expiry), leaseUntil: lease, sentAt: null },
      data: { sentAt: now },
    });
  }

  async release(chatId: string, expiry: string, lease: Date): Promise<void> {
    await this.db.membershipReminder.deleteMany({
      where: { chatId, expiresOn: keyToDbDate(expiry), leaseUntil: lease, sentAt: null },
    });
  }
}

export const membershipReminders = new MembershipReminderStore();
