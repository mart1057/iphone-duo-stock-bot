import { env } from '../config/env.js';
import { formatThaiDateTime } from '../utils/datetime.js';
import type { StatusSnapshot } from './status.report.js';

export interface AvailableItem {
  colorTh: string;
  storage: string;
  storeName: string;
}

/// Identifies one variant at one store, for matching a snapshot row against
/// the transitions that triggered the alert.
export const itemKey = (item: AvailableItem): string =>
  `${item.colorTh}|${item.storage}|${item.storeName}`;

/**
 * Groups what is in stock by branch.
 *
 * Reading "which colours can I get at Iconsiam" off a flat list means scanning
 * every line; grouped by store it is one glance, which is how someone actually
 * decides where to go.
 */
export const groupByStore = (items: readonly AvailableItem[]): Map<string, AvailableItem[]> => {
  const grouped = new Map<string, AvailableItem[]>();

  for (const item of [...items].sort(
    (a, b) =>
      a.storeName.localeCompare(b.storeName) ||
      a.storage.localeCompare(b.storage) ||
      a.colorTh.localeCompare(b.colorTh),
  )) {
    const bucket = grouped.get(item.storeName);
    if (bucket) bucket.push(item);
    else grouped.set(item.storeName, [item]);
  }

  return grouped;
};

/**
 * The shared body: summary counts, then everything in stock grouped by branch.
 *
 * `newKeys` marks the rows that only just became available, so a person can
 * tell at a glance what changed without losing the full picture.
 */
export const buildAvailabilityBody = (
  snapshot: StatusSnapshot,
  newKeys: ReadonlySet<string> = new Set(),
): string => {
  const lines: string[] = [
    `รุ่น: ${env.APPLE_MODEL_FILTER}`,
    `มีของ: ${snapshot.available} / ${snapshot.total}`,
    `ไม่มีของ: ${snapshot.unavailable}`,
  ];

  // Non-zero means Apple could not be reached for those - worth saying so,
  // because "ไม่มีของ" and "ไม่รู้" are very different answers.
  if (snapshot.unknown > 0) lines.push(`ไม่ทราบสถานะ: ${snapshot.unknown}`);

  lines.push(
    `ตรวจล่าสุด: ${
      snapshot.lastCheckedAt ? formatThaiDateTime(snapshot.lastCheckedAt) : 'ยังไม่เคยตรวจ'
    }`,
  );

  if (snapshot.inStock.length === 0) {
    lines.push('', '🔴 ยังไม่มีสินค้าพร้อมจำหน่าย');
    return lines.join('\n');
  }

  lines.push('', '🟢 พร้อมจำหน่าย');

  for (const [storeName, items] of groupByStore(snapshot.inStock)) {
    lines.push('', `📍 ${storeName}`);
    for (const item of items) {
      const isNew = newKeys.has(itemKey(item));
      lines.push(`   • ${item.colorTh} ${item.storage}${isNew ? '  🆕' : ''}`);
    }
  }

  return lines.join('\n');
};

/**
 * The alert sent when something has just come INTO stock.
 *
 * It leads with what changed (that is why the message exists) but then shows
 * the full current availability grouped by branch, so the reader does not have
 * to go and ask "and what else is there?" separately.
 */
export const buildStockAlertText = (
  transitions: readonly { stock: { model: string; colorTh: string; storage: string; storeName: string } }[],
  snapshot: StatusSnapshot,
): string => {
  const model = transitions[0]?.stock.model ?? env.APPLE_MODEL_FILTER;
  const newKeys = new Set(
    transitions.map((transition) =>
      itemKey({
        colorTh: transition.stock.colorTh,
        storage: transition.stock.storage,
        storeName: transition.stock.storeName,
      }),
    ),
  );

  return [
    `🍎 ${model} STOCK ALERT`,
    '',
    `🔔 เพิ่งมีของ ${transitions.length} รายการ`,
    '',
    buildAvailabilityBody(snapshot, newKeys),
  ].join('\n');
};
