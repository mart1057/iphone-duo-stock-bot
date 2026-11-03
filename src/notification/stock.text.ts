import { storageRank } from '../apple/apple.parser.js';
import { isMultiModel } from '../config/env.js';
import { mdLink, modelsOf, TAP_HINT } from './line.flex.js';
import { formatFriendly } from '../utils/datetime.js';
import { isMuted, type Mutes } from './alert.filter.js';
import type { StatusSnapshot } from './status.report.js';

export interface AvailableItem {
  model?: string;
  colorTh: string;
  storage: string;
  storeName: string;
  partNumber?: string;
}

/// Identifies one variant at one store, for matching a snapshot row against
/// the transitions that triggered the alert.
export const itemKey = (item: AvailableItem): string =>
  `${item.model ?? ''}|${item.colorTh}|${item.storage}|${item.storeName}`;

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
      (a.model ?? '').localeCompare(b.model ?? '') ||
      storageRank(a.storage) - storageRank(b.storage) ||
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
  /// Stock alerts only: each row becomes a tappable link to that SKU's page.
  { links = false }: { links?: boolean } = {},
): string => {
  const lines: string[] = [];

  // Name the model on each row only when rows from several models are shown.
  const mixed = isMultiModel() && new Set(snapshot.inStock.map((item) => item.model)).size > 1;

  if (snapshot.inStock.length === 0) {
    lines.push(snapshot.hidden ? '😢 ยังไม่มีของในแบบที่คุณเลือกไว้' : '😢 ตอนนี้ยังไม่มีของ');
  } else {
    lines.push('🛍️ ตอนนี้มีของที่');
    for (const [storeName, items] of groupByStore(snapshot.inStock)) {
      lines.push('', `📍 ${storeName}`);
      for (const item of items) {
        const isNew = newKeys.has(itemKey(item));
        const model = mixed && item.model ? `${item.model} · ` : '';
        const label = `${item.colorTh} ${item.storage}`;
        lines.push(`   • ${model}${links ? mdLink(label, item.partNumber) : label}${isNew ? ' 🆕' : ''}`);
      }
    }
  }

  // "No stock" and "could not ask Apple" must never look the same.
  if (snapshot.unknown > 0) lines.push('', '⚠️ บางรายการเช็คไม่ได้ชั่วคราว');
  if (snapshot.hidden) lines.push('', `🔕 ซ่อนอีก ${snapshot.hidden} รายการที่คุณปิดการเตือนไว้`);
  lines.push('', `⏰ เช็คล่าสุด ${snapshot.lastCheckedAt ? formatFriendly(snapshot.lastCheckedAt) : '-'}`);
  return lines.join('\n');
};

/// One model's slice of the snapshot, for that model's own alert.
export const snapshotForModel = (snapshot: StatusSnapshot, model: string): StatusSnapshot => {
  const inStock = snapshot.inStock.filter((item) => item.model === undefined || item.model === model);
  return { ...snapshot, inStock, available: inStock.length };
};

/// Drops the in-stock rows a chat has muted, remembering how many were hidden.
export const filterSnapshot = (snapshot: StatusSnapshot, mutes: Mutes): StatusSnapshot => {
  const inStock = snapshot.inStock.filter((item) => !isMuted(mutes, item));
  return { ...snapshot, inStock, hidden: snapshot.inStock.length - inStock.length };
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
  const model = modelsOf(transitions);
  // Full keys, plus model-less ones for snapshot rows that carry no model.
  const newKeys = new Set(
    transitions.flatMap((transition) => {
      const base = {
        colorTh: transition.stock.colorTh,
        storage: transition.stock.storage,
        storeName: transition.stock.storeName,
      };
      return [itemKey({ ...base, model: transition.stock.model }), itemKey(base)];
    }),
  );

  return [
    '🚨 ของเข้าแล้ว!',
    `📱 ${model}`,
    `🔔 เพิ่งเข้า ${transitions.length} รายการ`,
    '',
    buildAvailabilityBody(snapshot, newKeys, { links: true }),
    '',
    TAP_HINT,
  ].join('\n');
};
