import { env } from '../config/env.js';
import { prisma } from '../database/prisma.js';
import { formatThaiDateTime } from '../utils/datetime.js';
import type { OutboundMessage } from './channel.types.js';
import { buildSystemMessage } from './line.flex.js';
import { buildAvailabilityBody } from './stock.text.js';

export interface StatusSnapshot {
  total: number;
  available: number;
  unavailable: number;
  unknown: number;
  lastCheckedAt: Date | null;
  inStock: Array<{ colorTh: string; storage: string; storeName: string }>;
}

/**
 * Reads what the bot currently believes about every variant/store pair.
 *
 * The bot itself only ever pushes on a CHANGE, which is what keeps it quiet.
 * This is the on-demand counterpart: "what does it look like right now?".
 */
export const readStatus = async (): Promise<StatusSnapshot> => {
  const stocks = await prisma.stock.findMany({
    include: { variant: true, store: true },
  });

  const inStock = stocks
    .filter((stock) => stock.available)
    .map((stock) => ({
      colorTh: stock.variant.colorTh ?? stock.variant.color,
      storage: stock.variant.storage,
      storeName: stock.store.name,
    }))
    .sort(
      (a, b) =>
        a.storage.localeCompare(b.storage) ||
        a.colorTh.localeCompare(b.colorTh) ||
        a.storeName.localeCompare(b.storeName),
    );

  const lastChecked = stocks
    .map((stock) => stock.lastCheckedAt)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    total: stocks.length,
    available: stocks.filter((stock) => stock.available).length,
    unavailable: stocks.filter((stock) => !stock.available && stock.status === 'UNAVAILABLE').length,
    unknown: stocks.filter((stock) => stock.status === 'UNKNOWN').length,
    lastCheckedAt: lastChecked ?? null,
    inStock,
  };
};

export const buildStatusMessage = (snapshot: StatusSnapshot): OutboundMessage => {
  const title = '📊 สถานะสต็อกตอนนี้';
  const headline =
    snapshot.available > 0
      ? `พบสินค้าพร้อมจำหน่าย ${snapshot.available} รายการ`
      : 'ยังไม่มีสินค้าพร้อมจำหน่าย';

  const rows: Array<[string, string]> = [
    ['รุ่น', env.APPLE_MODEL_FILTER],
    ['มีของ', `${snapshot.available} / ${snapshot.total}`],
    ['ไม่มีของ', `${snapshot.unavailable}`],
  ];
  if (snapshot.unknown > 0) rows.push(['ไม่ทราบสถานะ', `${snapshot.unknown}`]);
  rows.push([
    'ตรวจล่าสุด',
    snapshot.lastCheckedAt ? formatThaiDateTime(snapshot.lastCheckedAt) : 'ยังไม่เคยตรวจ',
  ]);

  return {
    flex: buildSystemMessage(
      title,
      headline,
      [
        ...rows,
        ...snapshot.inStock.map(
          (item): [string, string] => [`${item.colorTh} ${item.storage}`, item.storeName],
        ),
      ],
      snapshot.available > 0 ? 'ok' : 'warn',
    ),
    text: [title, '', headline, '', buildAvailabilityBody(snapshot)].join('\n'),
  };
};
