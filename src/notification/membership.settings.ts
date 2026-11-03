import type { PrismaClient } from '@prisma/client';
import { prisma } from '../database/prisma.js';

export const parseMembershipPrice = (text: string): number | null => {
  const value = text.trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(value)) return null;
  const [baht = '0', satang = ''] = value.split('.');
  return Number(baht) * 100 + Number(satang.padEnd(2, '0'));
};

export const formatMembershipPrice = (satang: number): string =>
  `${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;

export class MembershipSettingsStore {
  constructor(private readonly db: PrismaClient = prisma) {}

  async price(): Promise<number | null> {
    const row = await this.db.membershipSettings.findUnique({ where: { id: 'default' } });
    return row?.priceSatang ?? null;
  }

  async setPrice(priceSatang: number): Promise<void> {
    if (!Number.isSafeInteger(priceSatang) || priceSatang < 0 || priceSatang > 99_999_999) {
      throw new Error('Invalid membership price');
    }
    await this.db.membershipSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', priceSatang },
      update: { priceSatang },
    });
  }
}

export const membershipSettings = new MembershipSettingsStore();
