import { timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma as defaultPrisma } from '../database/prisma.js';
import { dbDateKey, keyToDbDate } from '../utils/datetime.js';
import { logger } from '../utils/logger.js';

export interface Subscriber {
  chatId: string;
  name: string | null;
  username: string | null;
  joinedAt: Date;
  approved?: boolean;
  /// Last day of membership; null / undefined = never expires.
  expiresOn?: Date | null;
}

/// Constant-time compare, so the invite code cannot be guessed by timing.
export const inviteCodeMatches = (candidate: string | undefined, code = env.TELEGRAM_INVITE_CODE): boolean => {
  if (!code || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(code);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Who the Telegram bot talks to:
 *   admins      - TELEGRAM_CHAT_ID in .env, full control
 *   subscribers - opened the invite link AND were approved by an admin
 *   pending     - opened the invite link, waiting for an admin; gets nothing
 */
export class TelegramRecipients {
  private cache: Subscriber[] | null = null;
  private cachedAt = 0;
  /// Short TTL so changes made by another process (the standalone admin UI)
  /// reach the bot within seconds.
  private static readonly CACHE_TTL_MS = 15_000;

  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  isAdmin(chatId: string): boolean {
    return env.telegramChatIds.includes(chatId);
  }

  private async everyone(): Promise<Subscriber[]> {
    if (!this.cache || Date.now() - this.cachedAt > TelegramRecipients.CACHE_TTL_MS) {
      this.cache = await this.db.telegramSubscriber.findMany({ orderBy: { joinedAt: 'asc' } });
      this.cachedAt = Date.now();
    }
    return this.cache;
  }

  /// Approved members only - the people who get alerts and menus.
  async subscribers(): Promise<Subscriber[]> {
    return (await this.everyone()).filter((subscriber) => subscriber.approved !== false);
  }

  /// Opened the link, waiting for an admin.
  async pending(): Promise<Subscriber[]> {
    return (await this.everyone()).filter((subscriber) => subscriber.approved === false);
  }

  async isPending(chatId: string): Promise<boolean> {
    return (await this.pending()).some((subscriber) => subscriber.chatId === chatId);
  }

  async find(chatId: string): Promise<Subscriber | undefined> {
    return (await this.everyone()).find((subscriber) => subscriber.chatId === chatId);
  }

  async isMember(chatId: string): Promise<boolean> {
    if (this.isAdmin(chatId)) return true;
    return (await this.subscribers()).some((subscriber) => subscriber.chatId === chatId);
  }

  /// Everyone who should receive stock alerts. Falls back to admins only if
  /// the database is down, so at least the owner still hears about stock.
  async all(): Promise<string[]> {
    try {
      const ids = (await this.subscribers()).map((subscriber) => subscriber.chatId);
      return [...new Set([...env.telegramChatIds, ...ids])];
    } catch (error) {
      logger.warn('Could not read Telegram subscribers - alerting admins only', error);
      return [...env.telegramChatIds];
    }
  }

  /// Records a join request (approved = false). Returns false when the chat
  /// already has a request or is already a member.
  async request(subscriber: { chatId: string; name?: string | null; username?: string | null }): Promise<boolean> {
    try {
      const existing = await this.db.telegramSubscriber.findUnique({ where: { chatId: subscriber.chatId } });
      if (existing) return false;
      await this.db.telegramSubscriber.create({
        data: {
          chatId: subscriber.chatId,
          name: subscriber.name ?? null,
          username: subscriber.username ?? null,
          approved: false,
        },
      });
      return true;
    } finally {
      this.cache = null;
    }
  }

  /// Turns a pending request into a member. Returns false when there was no
  /// pending request (already approved, rejected, or withdrawn).
  async approve(chatId: string): Promise<boolean> {
    try {
      const result = await this.db.telegramSubscriber.updateMany({
        where: { chatId, approved: false },
        data: { approved: true, approvedAt: new Date() },
      });
      return result.count > 0;
    } finally {
      this.cache = null;
    }
  }

  /// Sets (or clears, with null) a member's expiry date "YYYY-MM-DD".
  /// Returns false when the chat is not an approved member.
  async setExpiry(chatId: string, key: string | null): Promise<boolean> {
    try {
      const result = await this.db.telegramSubscriber.updateMany({
        where: { chatId, approved: true },
        data: { expiresOn: key ? keyToDbDate(key) : null },
      });
      return result.count > 0;
    } finally {
      this.cache = null;
    }
  }

  /// Approved members whose expiry date is on or before `today`.
  async expiredBy(today: string): Promise<Subscriber[]> {
    return (await this.subscribers()).filter(
      (subscriber) => subscriber.expiresOn && dbDateKey(subscriber.expiresOn) <= today,
    );
  }

  /// Returns false when there was nothing to remove.
  async remove(chatId: string): Promise<boolean> {
    try {
      const result = await this.db.telegramSubscriber.deleteMany({ where: { chatId } });
      return result.count > 0;
    } finally {
      this.cache = null;
    }
  }
}

export const telegramRecipients = new TelegramRecipients();
