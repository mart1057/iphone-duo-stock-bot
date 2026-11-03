/**
 * Realistic restock scenarios rendered by the REAL alert pipeline
 * (NotificationService -> per-model messages), captured instead of sent.
 * Used by `npm run notify:samples` and handy for reviewing the wording.
 */
import { toThaiColor } from '../apple/apple.parser.js';
import { emptyMutes, variantValue, type Mutes } from '../notification/alert.filter.js';
import type { OutboundMessage } from '../notification/channel.types.js';
import { NotificationService } from '../notification/notification.service.js';
import type { StatusSnapshot } from '../notification/status.report.js';
import type { StockTransition } from '../stock/stock.types.js';

const DUO = 'iPhone Duo';
const PRO_MAX = 'iPhone 18 Pro Max';

interface Item {
  model: string;
  color: string;
  storage: string;
  store: string;
}

const item = (model: string, color: string, storage: string, store: string): Item => ({ model, color, storage, store });

/// Finds the real Apple part number of a variant, for the SKU links.
export type PartNumberLookup = (model: string, color: string, storage: string) => string | undefined;

/// iPhone Duo part numbers (apple.com/th/xc/product/<part>), used when the
/// database is not at hand (tests).
const DUO_PARTS: Record<string, string> = {
  'Star White|256GB': 'MK2D4ZP/A', 'Star White|512GB': 'MK2F4ZP/A', 'Star White|1TB': 'MK2H4ZP/A', 'Star White|2TB': 'MK2K4ZP/A',
  'Night Sky|256GB': 'MK2E4ZP/A', 'Night Sky|512GB': 'MK2G4ZP/A', 'Night Sky|1TB': 'MK2J4ZP/A', 'Night Sky|2TB': 'MK2L4ZP/A',
};
const builtInParts: PartNumberLookup = (model, color, storage) =>
  model === DUO ? DUO_PARTS[`${color}|${storage}`] : undefined;

let partOf: PartNumberLookup = builtInParts;

const transition = (entry: Item, checkedAt: Date): StockTransition => ({
  stockId: `sample-${entry.model}-${entry.color}-${entry.storage}-${entry.store}`,
  previousStatus: 'UNAVAILABLE',
  currentStatus: 'AVAILABLE',
  stock: {
    model: entry.model,
    color: entry.color,
    colorTh: toThaiColor(entry.color),
    storage: entry.storage,
    partNumber: partOf(entry.model, entry.color, entry.storage) ?? 'SAMPLE',
    basePart: 'SAMPLE',
    priceTHB: null,
    storeName: entry.store,
    storeCode: 'R000',
    status: 'AVAILABLE',
    available: true,
    checkedAt,
  },
});

export interface AlertSample {
  label: string;
  /// Each message the bot would send (first copy only), in send order.
  texts: string[];
}

/// Runs the real NotificationService and returns what it would send.
const render = async (
  arrived: Item[],
  alsoInStock: Item[],
  mutes?: Mutes,
): Promise<string[]> => {
  const checkedAt = new Date();
  const inStock = [...arrived, ...alsoInStock].map((entry) => ({
    model: entry.model,
    color: entry.color,
    colorTh: toThaiColor(entry.color),
    storage: entry.storage,
    storeName: entry.store,
    partNumber: partOf(entry.model, entry.color, entry.storage),
  }));
  const snapshot: StatusSnapshot = {
    total: 24, available: inStock.length, unavailable: 24 - inStock.length, unknown: 0, lastCheckedAt: checkedAt, inStock,
  };
  const sent: OutboundMessage[] = [];
  const capture = { push: async (message: OutboundMessage) => { sent.push(message); return { success: true, messageId: null, results: [] }; } };
  const service = new NotificationService(capture as never, { logNotification: async () => undefined } as never,
    async () => snapshot, async () => undefined);
  await service.notify({ transitions: arrived.map((entry) => transition(entry, checkedAt)), firstRun: false } as never);
  const firstCopies = sent.filter((message) => !message.stockReminder);
  return firstCopies
    .map((message) => (mutes && message.renderFiltered ? message.renderFiltered(mutes) : message.text))
    .filter((text): text is string => text !== null);
};

export const buildAlertSamples = async (lookup?: PartNumberLookup): Promise<AlertSample[]> => {
  partOf = lookup ? (model, color, storage) => lookup(model, color, storage) ?? builtInParts(model, color, storage) : builtInParts;
  const cw = 'Apple Central World';
  const icon = 'Apple Iconsiam';
  const paragon = 'Apple Siam Paragon';
  const no2TB: Mutes = { ...emptyMutes(), variant: new Set([variantValue(PRO_MAX, 'Silver', '2TB')]) };

  return [
    {
      label: '1) iPhone Duo เข้า 1 รายการ (ยังไม่มีอย่างอื่น)',
      texts: await render([item(DUO, 'Night Sky', '256GB', cw)], []),
    },
    {
      label: '2) iPhone Duo เข้า 3 รายการ หลายสาขา (มีของเดิมอยู่แล้ว 1 รายการ)',
      texts: await render(
        [item(DUO, 'Night Sky', '256GB', cw), item(DUO, 'Star White', '512GB', icon), item(DUO, 'Night Sky', '1TB', icon)],
        [item(DUO, 'Star White', '256GB', cw)],
      ),
    },
    {
      label: '3) iPhone 18 Pro Max เข้า 1 รายการ',
      texts: await render([item(PRO_MAX, 'Burgundy', '256GB', cw)], []),
    },
    {
      label: '4) iPhone 18 Pro Max เข้าหลายรายการ (6 รายการ 3 สาขา)',
      texts: await render([
        item(PRO_MAX, 'Black', '256GB', cw), item(PRO_MAX, 'Silver', '256GB', cw), item(PRO_MAX, 'Burgundy', '512GB', cw),
        item(PRO_MAX, 'Glacier', '1TB', icon), item(PRO_MAX, 'Black', '2TB', icon), item(PRO_MAX, 'Burgundy', '256GB', paragon),
      ], []),
    },
    {
      label: '5) ทั้ง 2 รุ่นเข้าพร้อมกัน (Duo 2 + Pro Max 3) → แยก 2 ข้อความ',
      texts: await render(
        [
          item(DUO, 'Night Sky', '256GB', cw), item(DUO, 'Star White', '2TB', paragon),
          item(PRO_MAX, 'Burgundy', '256GB', cw), item(PRO_MAX, 'Black', '1TB', icon), item(PRO_MAX, 'Silver', '2TB', icon),
        ],
        [item(DUO, 'Night Sky', '512GB', icon)],
      ),
    },
    {
      label: '6) แบบเดียวกับข้อ 5 แต่คนที่ปิดเตือน Pro Max เงิน 2TB ไว้ จะเห็นแบบนี้',
      texts: await render(
        [
          item(DUO, 'Night Sky', '256GB', cw), item(DUO, 'Star White', '2TB', paragon),
          item(PRO_MAX, 'Burgundy', '256GB', cw), item(PRO_MAX, 'Black', '1TB', icon), item(PRO_MAX, 'Silver', '2TB', icon),
        ],
        [item(DUO, 'Night Sky', '512GB', icon)],
        no2TB,
      ),
    },
  ];
};
