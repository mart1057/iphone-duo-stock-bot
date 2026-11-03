import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

export const HISTORY_RETENTION_MS = 72 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function pruneHistory(
  now = new Date(),
  db: PrismaClient = prisma,
  restockRetentionDays: number = env.RESTOCK_HISTORY_RETENTION_DAYS,
) {
  const cutoff = new Date(now.getTime() - HISTORY_RETENTION_MS);
  // Definitive AVAILABLE / UNAVAILABLE edges feed the Telegram /history menu,
  // so they are kept longer. They are one row per change, so this stays small.
  const restockCutoff = new Date(now.getTime() - Math.max(3, restockRetentionDays) * DAY_MS);
  // Delete children only. Stock is the notification baseline and must survive.
  // Limit DB time so maintenance cannot hold resources indefinitely.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    const unknown = await tx.stockHistory.deleteMany({
      where: { status: 'UNKNOWN', checkedAt: { lt: cutoff } },
    });
    const definitive = await tx.stockHistory.deleteMany({
      where: { checkedAt: { lt: restockCutoff } },
    });
    const notifications = await tx.notificationLog.deleteMany({
      where: { sentAt: { lt: cutoff } },
    });
    return {
      cutoff,
      restockCutoff,
      history: unknown.count + definitive.count,
      notifications: notifications.count,
    };
  }, { maxWait: 2000, timeout: 12_000 });
}
