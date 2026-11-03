import { monitoredModelsLabel } from '../config/env.js';
import { prisma } from '../database/prisma.js';
import { modelPauseStore } from '../stock/model.pause.js';
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
  inStock: Array<{ colorTh: string; storage: string; storeName: string; model?: string; color?: string; partNumber?: string }>;
  /// In-stock rows left out by a chat's alert filter.
  hidden?: number;
}

/**
 * Reads what the bot currently believes about every variant/store pair.
 *
 * The bot itself only ever pushes on a CHANGE, which is what keeps it quiet.
 * This is the on-demand counterpart: "what does it look like right now?".
 */
export const readStatus = async (): Promise<StatusSnapshot> => {
  // A paused model's rows are its last answer before the pause - stale, and
  // members must not see the model at all - so they are left out entirely.
  const paused = await modelPauseStore.pausedModels();
  const stocks = (await prisma.stock.findMany({
    include: { variant: { include: { product: true } }, store: true },
  })).filter((stock) => !paused.has(stock.variant.product.model));

  const inStock = stocks
    .filter((stock) => stock.available)
    .map((stock) => ({
      colorTh: stock.variant.colorTh ?? stock.variant.color,
      storage: stock.variant.storage,
      storeName: stock.store.name,
      model: stock.variant.product.model,
      color: stock.variant.color,
      partNumber: stock.variant.partNumber,
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
  const title = '📊 สถานะบอท';
  const headline =
    snapshot.available > 0
      ? `🟢 มีของ ${snapshot.available} รายการ`
      : '😢 ยังไม่มีของ';

  const rows: Array<[string, string]> = [
    ['รุ่น', monitoredModelsLabel()],
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
