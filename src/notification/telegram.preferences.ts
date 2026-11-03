import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../database/prisma.js';
import { emptyMutes, MUTE_KINDS, type MuteKind, type Mutes } from './alert.filter.js';

/**
 * Persists which models / colors / storages each Telegram chat has muted.
 *
 * Reads are cached in memory: the stock alert path asks for every chat on
 * every alert, while the settings only change when someone taps a button.
 */
export class TelegramAlertPreferences {
  private readonly cache = new Map<string, Mutes>();

  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async getMutes(chatId: string): Promise<Mutes> {
    return (await this.getMutesFor([chatId])).get(chatId) ?? emptyMutes();
  }

  async getMutesFor(chatIds: readonly string[]): Promise<Map<string, Mutes>> {
    const missing = chatIds.filter((chatId) => !this.cache.has(chatId));
    if (missing.length > 0) {
      const rows = await this.db.telegramAlertMute.findMany({
        where: { chatId: { in: missing } },
        select: { chatId: true, kind: true, value: true },
      });
      for (const chatId of missing) {
        const mutes: Record<MuteKind, Set<string>> = {
          model: new Set(),
          color: new Set(),
          storage: new Set(),
          variant: new Set(),
        };
        for (const row of rows) {
          if (row.chatId === chatId && isMuteKind(row.kind)) mutes[row.kind].add(row.value);
        }
        this.cache.set(chatId, mutes);
      }
    }
    return new Map(chatIds.map((chatId) => [chatId, this.cache.get(chatId) ?? emptyMutes()]));
  }

  /// Flips one value; returns true when the value is muted afterwards.
  async toggle(chatId: string, kind: MuteKind, value: string): Promise<boolean> {
    const where = { chatId_kind_value: { chatId, kind, value } };
    const existing = await this.db.telegramAlertMute.findUnique({ where, select: { id: true } });
    try {
      if (existing) {
        await this.db.telegramAlertMute.delete({ where });
      } else {
        await this.db.telegramAlertMute.create({ data: { chatId, kind, value } });
      }
    } finally {
      this.cache.delete(chatId);
    }
    return !existing;
  }

  /// Mutes every given value of one kind (e.g. "ปิดทุกสี").
  async muteAll(chatId: string, kind: MuteKind, values: readonly string[]): Promise<void> {
    try {
      await this.db.telegramAlertMute.createMany({
        data: values.map((value) => ({ chatId, kind, value })),
        skipDuplicates: true,
      });
    } finally {
      this.cache.delete(chatId);
    }
  }

  /// Unmutes the given values of one kind.
  async unmute(chatId: string, kind: MuteKind, values: readonly string[]): Promise<void> {
    try {
      await this.db.telegramAlertMute.deleteMany({ where: { chatId, kind, value: { in: [...values] } } });
    } finally {
      this.cache.delete(chatId);
    }
  }

  /// Unmutes one kind, or everything when kind is omitted.
  async unmuteAll(chatId: string, kind?: MuteKind): Promise<void> {
    try {
      await this.db.telegramAlertMute.deleteMany({ where: kind ? { chatId, kind } : { chatId } });
    } finally {
      this.cache.delete(chatId);
    }
  }
}

const isMuteKind = (value: string): value is MuteKind =>
  (MUTE_KINDS as readonly string[]).includes(value);

export const telegramAlertPreferences = new TelegramAlertPreferences();
