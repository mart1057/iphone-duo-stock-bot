import type { PrismaClient } from '@prisma/client';
import { storageRank } from '../apple/apple.parser.js';
import { prisma as defaultPrisma } from '../database/prisma.js';
import { formatFriendly } from '../utils/datetime.js';

export interface CurrentSku {
  model: string;
  color: string;
  colorTh: string;
  storage: string;
  /// Stores whose last DEFINITIVE answer was "available".
  availableAt: string[];
  /// Every store's latest observation was UNKNOWN (Apple not reachable).
  unknown: boolean;
}

export interface CurrentModelStock {
  model: string;
  /// An admin paused checks for this model - the data below is stale.
  paused?: boolean;
  lastCheckedAt: Date | null;
  skus: CurrentSku[];
}

const shortStore = (name: string): string => name.replace(/^Apple\s+/i, '');

const ofLabel = (count: number, total: number): string => `${count} จาก ${total} แบบ`;

/**
 * What the bot believes about one model right now - read from the last
 * check, never a fresh request to Apple. Includes what is sold out.
 */
export const buildCurrentStockText = (
  stock: CurrentModelStock,
  isMuted: (sku: CurrentSku) => boolean = () => false,
): string => {
  const lines = [`📦 ของที่มีตอนนี้`, `📱 ${stock.model}`];
  if (stock.paused) {
    lines.push('', '⏸️ ตอนนี้หยุดเช็ครุ่นนี้ชั่วคราว', 'จะไม่มีการแจ้งเตือนจนกว่าจะเริ่มเช็คใหม่');
    return lines.join('\n');
  }
  if (stock.skus.length === 0) {
    lines.push('', '⏳ ยังไม่มีข้อมูลรุ่นนี้ รอบอทเช็คครั้งแรกก่อนนะ');
    return lines.join('\n');
  }

  const inStock = stock.skus.filter((sku) => sku.availableAt.length > 0);
  const unknown = stock.skus.filter((sku) => sku.availableAt.length === 0 && sku.unknown);
  const soldOut = stock.skus.filter((sku) => sku.availableAt.length === 0 && !sku.unknown);
  const label = (sku: CurrentSku): string => `${sku.colorTh} ${sku.storage}${isMuted(sku) ? ' 🔕' : ''}`;

  lines.push('');
  if (inStock.length === 0) {
    lines.push('😢 ตอนนี้ยังไม่มีของ');
  } else {
    lines.push(`✅ มีของ ${ofLabel(inStock.length, stock.skus.length)}`);
    for (const sku of inStock) {
      lines.push('', `🟢 ${label(sku)}`, `   📍 ${sku.availableAt.map(shortStore).join(', ')}`);
    }
  }
  if (soldOut.length > 0) {
    lines.push('', '🔴 หมด', ...soldOut.map((sku) => `   • ${label(sku)}`));
  }
  if (unknown.length > 0) {
    lines.push('', '⚠️ เช็คไม่ได้ชั่วคราว', ...unknown.map((sku) => `   • ${label(sku)}`));
  }
  if (stock.skus.some(isMuted)) lines.push('', '🔕 = แบบที่คุณปิดการเตือนไว้');
  lines.push('', `⏰ เช็คล่าสุด ${stock.lastCheckedAt ? formatFriendly(stock.lastCheckedAt) : '-'}`);
  return lines.join('\n');
};

/**
 * Every model in one message: what is in stock and where. Sold-out items are
 * only counted, so the answer stays short enough to read at a glance.
 */
export const buildAllStockText = (
  stocks: readonly CurrentModelStock[],
  isMuted: (sku: CurrentSku) => boolean = () => false,
): string => {
  const checked = stocks
    .filter((stock) => !stock.paused)
    .map((stock) => stock.lastCheckedAt)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const lines = ['📦 ของที่มีตอนนี้'];
  if (stocks.length === 0) {
    lines.push('', '⏳ ยังไม่มีข้อมูล รอบอทเช็คครั้งแรกก่อนนะ');
    return lines.join('\n');
  }

  let anyMuted = false;
  for (const stock of stocks) {
    const inStock = stock.skus.filter((sku) => sku.availableAt.length > 0);
    const unknown = stock.skus.filter((sku) => sku.availableAt.length === 0 && sku.unknown).length;
    lines.push('', `📱 ${stock.model}`);
    if (stock.paused) {
      lines.push('⏸️ หยุดเช็ครุ่นนี้ชั่วคราว');
      continue;
    }
    if (stock.skus.length === 0) {
      lines.push('⏳ ยังไม่มีข้อมูลรุ่นนี้');
      continue;
    }
    if (inStock.length === 0) {
      lines.push('😢 ยังไม่มีของ');
    } else {
      lines.push(`✅ มีของ ${ofLabel(inStock.length, stock.skus.length)}`);
      for (const sku of inStock) {
        const muted = isMuted(sku);
        anyMuted ||= muted;
        lines.push(`   🟢 ${sku.colorTh} ${sku.storage}${muted ? ' 🔕' : ''}`, `       📍 ${sku.availableAt.map(shortStore).join(', ')}`);
      }
    }
    if (unknown > 0) lines.push(`⚠️ เช็คไม่ได้ชั่วคราว ${unknown} แบบ`);
  }
  if (anyMuted) lines.push('', '🔕 = แบบที่คุณปิดการเตือนไว้');
  lines.push('', `⏰ เช็คล่าสุด ${checked ? formatFriendly(checked) : '-'}`);
  return lines.join('\n');
};

export class CurrentStockRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async forModel(model: string): Promise<CurrentModelStock> {
    const rows = await this.db.stock.findMany({
      where: { variant: { product: { model } } },
      select: {
        available: true,
        status: true,
        lastCheckedAt: true,
        store: { select: { name: true } },
        variant: { select: { id: true, color: true, colorTh: true, storage: true } },
      },
    });

    const bySku = new Map<string, CurrentSku>();
    let lastCheckedAt: Date | null = null;
    for (const row of rows) {
      if (row.lastCheckedAt && (!lastCheckedAt || row.lastCheckedAt > lastCheckedAt)) {
        lastCheckedAt = row.lastCheckedAt;
      }
      const sku = bySku.get(row.variant.id) ?? {
        model,
        color: row.variant.color,
        colorTh: row.variant.colorTh ?? row.variant.color,
        storage: row.variant.storage,
        availableAt: [],
        unknown: true,
      };
      if (row.available) sku.availableAt.push(row.store.name);
      if (row.status !== 'UNKNOWN') sku.unknown = false;
      bySku.set(row.variant.id, sku);
    }

    const skus = [...bySku.values()]
      .map((sku) => ({ ...sku, availableAt: [...sku.availableAt].sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => storageRank(a.storage) - storageRank(b.storage) || a.colorTh.localeCompare(b.colorTh));
    return { model, lastCheckedAt, skus };
  }
}

export const currentStockRepository = new CurrentStockRepository();
