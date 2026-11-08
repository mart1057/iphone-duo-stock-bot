import type { RestockHour } from '../notification/restock.statistics.js';
import type { PrismaClient } from '@prisma/client';
import { storageRank } from '../apple/apple.parser.js';
import { env } from '../config/env.js';
import { prisma as defaultPrisma } from '../database/prisma.js';
import { formatShortDateTime, hourOfDay } from '../utils/datetime.js';

export interface SkuOption {
  variantId: string;
  model: string;
  color: string;
  colorTh: string;
  storage: string;
  partNumber: string;
}

export interface HistoryRow {
  stockId: string;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  checkedAt: Date;
  storeName: string;
  /// Current Stock.available - tells "still in stock" from "sold-out missed".
  currentlyAvailable: boolean;
}

export interface RestockEvent {
  storeName: string;
  at: Date;
  /// When the bot saw it go back to UNAVAILABLE; null if not (yet) observed.
  soldOutAt: Date | null;
  stillAvailable: boolean;
}

export const sortSkus = <T extends { model: string; storage: string; color: string }>(skus: T[]): T[] =>
  [...skus].sort(
    (a, b) =>
      a.model.localeCompare(b.model) ||
      storageRank(a.storage) - storageRank(b.storage) ||
      a.color.localeCompare(b.color),
  );

/**
 * Turns raw StockHistory rows into restock events.
 *
 * The detector only writes an AVAILABLE history row on a false -> true edge
 * (never for the silent first observation), so every AVAILABLE row IS a
 * restock. The next UNAVAILABLE row for the same stock is when it sold out.
 * Rows must be sorted oldest first. Result is newest first.
 */
export const pairRestocks = (rows: readonly HistoryRow[]): RestockEvent[] => {
  const open = new Map<string, RestockEvent>();
  const events: RestockEvent[] = [];

  for (const row of rows) {
    if (row.status === 'AVAILABLE') {
      const event: RestockEvent = {
        storeName: row.storeName,
        at: row.checkedAt,
        soldOutAt: null,
        stillAvailable: false,
      };
      events.push(event);
      open.set(row.stockId, event);
    } else if (row.status === 'UNAVAILABLE') {
      const event = open.get(row.stockId);
      if (event) {
        event.soldOutAt = row.checkedAt;
        open.delete(row.stockId);
      }
    }
  }

  // Still open AND currently in stock = it has not sold out yet.
  for (const row of rows) {
    const event = open.get(row.stockId);
    if (event && row.currentlyAvailable) event.stillAvailable = true;
  }

  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
};

export const formatDuration = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'ไม่ถึง 1 นาที';
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชม. ${minutes % 60} นาที`;
  return `${Math.floor(hours / 24)} วัน ${hours % 24} ชม.`;
};

/// 180 -> "6 เดือน", 30 -> "1 เดือน", 45 -> "45 วัน".
export const periodLabel = (days: number): string =>
  days >= 30 && days % 30 === 0 ? `${days / 30} เดือน` : `${days} วัน`;

export const skuLabel = (sku: Pick<SkuOption, 'model' | 'colorTh' | 'storage'>): string =>
  `${sku.model} · ${sku.colorTh} · ${sku.storage}`;

const MAX_ROWS = 10;

export const buildRestockHistoryText = (
  sku: SkuOption,
  events: readonly RestockEvent[],
  days: number,
): string => {
  const lines = ['📈 สถิติของเคยเข้า', `📱 ${sku.model}`, `🎨 ${sku.colorTh}  💾 ${sku.storage}`, ''];

  if (events.length === 0) {
    lines.push(`😢 ${periodLabel(days)}ที่ผ่านมา ยังไม่เคยมีของเข้า`);
    return lines.join('\n');
  }

  lines.push(`📊 ${periodLabel(days)}ที่ผ่านมา ของเข้า ${events.length} ครั้ง`);
  lines.push(`🆕 ล่าสุด ${formatShortDateTime(events[0]!.at)} น.`);

  if (events.length >= 3) {
    const byHour = new Map<number, number>();
    for (const event of events) {
      const hour = hourOfDay(event.at);
      byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
    }
    const [topHour, topCount] = [...byHour].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
    const pad = (hour: number): string => String(hour).padStart(2, '0');
    lines.push(`⏰ เข้าบ่อยช่วง ${pad(topHour)}:00–${pad((topHour + 1) % 24)}:00 น. (${topCount} ครั้ง)`);
  }

  const byStore = new Map<string, number>();
  for (const event of events) byStore.set(event.storeName, (byStore.get(event.storeName) ?? 0) + 1);
  lines.push('', '📍 แยกตามสาขา');
  for (const [store, count] of [...byStore].sort((a, b) => b[1] - a[1])) {
    lines.push(`   • ${store.replace(/^Apple\s+/i, '')} — ${count} ครั้ง`);
  }

  lines.push('', `🗓️ ${Math.min(MAX_ROWS, events.length)} ครั้งล่าสุด`);
  for (const event of events.slice(0, MAX_ROWS)) {
    const store = event.storeName.replace(/^Apple\s+/i, '');
    const tail = event.soldOutAt
      ? `⏱️ หมดภายใน ${formatDuration(event.soldOutAt.getTime() - event.at.getTime())}`
      : event.stillAvailable
        ? '🟢 ยังมีของอยู่'
        : '❔ ไม่รู้ว่าหมดตอนไหน';
    lines.push(`• ${formatShortDateTime(event.at)} น. · ${store}`, `   ${tail}`);
  }

  lines.push('', 'ℹ️ เวลาที่แสดง คือเวลาที่บอทเจอของ');
  return lines.join('\n');
};

export class RestockHistoryRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  retentionDays(): number {
    return env.RESTOCK_HISTORY_RETENTION_DAYS;
  }

  private since(now: Date): Date {
    return new Date(now.getTime() - this.retentionDays() * 24 * 60 * 60 * 1000);
  }

  /// Aggregate in PostgreSQL so long retained histories do not fill bot memory.
  async statistics(from: Date, toExclusive: Date): Promise<RestockHour[]> {
    const rows = await this.db.$queryRaw<Array<{ day: string; hour: number; minute: number; count: bigint }>>`
      SELECT to_char(checked_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
             EXTRACT(HOUR FROM checked_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::int AS hour,
             EXTRACT(MINUTE FROM checked_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::int AS minute,
             COUNT(*) AS count
      FROM stock_history
      WHERE status = 'AVAILABLE' AND checked_at >= ${from} AND checked_at < ${toExclusive}
      GROUP BY day, hour, minute ORDER BY day DESC, hour ASC, minute ASC
    `;
    return rows.map((row) => ({ ...row, count: Number(row.count) }));
  }

  async listSkus(): Promise<SkuOption[]> {
    const variants = await this.db.productVariant.findMany({
      select: {
        id: true,
        color: true,
        colorTh: true,
        storage: true,
        partNumber: true,
        product: { select: { model: true } },
      },
    });
    return sortSkus(
      variants.map((variant) => ({
        variantId: variant.id,
        model: variant.product.model,
        color: variant.color,
        colorTh: variant.colorTh ?? variant.color,
        storage: variant.storage,
        partNumber: variant.partNumber,
      })),
    );
  }

  /// Restock count per variantId within the retention window.
  async restockCounts(now = new Date()): Promise<Map<string, number>> {
    const rows = await this.db.stockHistory.findMany({
      where: { status: 'AVAILABLE', checkedAt: { gte: this.since(now) } },
      select: { stock: { select: { variantId: true } } },
    });
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.stock.variantId, (counts.get(row.stock.variantId) ?? 0) + 1);
    return counts;
  }

  async restocks(variantId: string, now = new Date()): Promise<RestockEvent[]> {
    const rows = await this.db.stockHistory.findMany({
      where: {
        stock: { variantId },
        status: { in: ['AVAILABLE', 'UNAVAILABLE'] },
        checkedAt: { gte: this.since(now) },
      },
      select: {
        stockId: true,
        status: true,
        checkedAt: true,
        stock: { select: { available: true, store: { select: { name: true } } } },
      },
      orderBy: { checkedAt: 'asc' },
      take: 5000,
    });
    return pairRestocks(
      rows.map((row) => ({
        stockId: row.stockId,
        status: row.status,
        checkedAt: row.checkedAt,
        storeName: row.stock.store.name,
        currentlyAvailable: row.stock.available,
      })),
    );
  }
}

export const restockHistoryRepository = new RestockHistoryRepository();
