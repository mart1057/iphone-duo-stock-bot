import type { ProductStock, StockStatus } from '../stock/stock.types.js';
import { logger } from '../utils/logger.js';
import type {
  AppleCatalogEntry,
  AppleStore,
  AppleVariant,
  PartAvailability,
  PickupMessageResponse,
  PickupStore,
} from './apple.types.js';

/**
 * Apple returns colour names in English inside the buy-flow `products` array
 * ("iPhone 18 Pro Max 256GB Burgundy") and in Thai inside pickup-message
 * (`storePickupProductTitle`). We key on the English name and keep a Thai
 * display map for the LINE message.
 *
 * NOTE: Apple's own Thai storefront currently renders Glacier as "สีเกลเซียร์";
 * "ธารน้ำแข็ง" is used here because that is the wording requested for alerts.
 */
export const COLOR_EN_TO_TH: Readonly<Record<string, string>> = {
  Black: 'ดำ',
  Silver: 'เงิน',
  Glacier: 'ธารน้ำแข็ง',
  Burgundy: 'เบอร์กันดี',
  // iPhone Duo
  'Star White': 'สตาร์ไวท์',
  'Night Sky': 'ไนท์สกาย',
};

/// Reverse lookup, so a Thai label coming from Apple maps back to canonical EN.
export const COLOR_TH_TO_EN: Readonly<Record<string, string>> = {
  ดำ: 'Black',
  เงิน: 'Silver',
  ธารน้ำแข็ง: 'Glacier',
  เกลเซียร์: 'Glacier',
  เบอร์กันดี: 'Burgundy',
  สตาร์ไวท์: 'Star White',
  ไนท์สกาย: 'Night Sky',
};

export const toThaiColor = (colorEn: string): string => COLOR_EN_TO_TH[colorEn] ?? colorEn;

/**
 * Extracts the buy-flow product catalogue embedded in the product page HTML.
 * Real shape (verified against apple.com/th):
 *   {"sku":"MJXQ4","partNumber":"MJXQ4ZP/A","price":{"fullPrice":52900.00},
 *    "category":"iphone","name":"iPhone 18 Pro Max 256GB Burgundy"}
 */
const CATALOG_ENTRY_RE =
  /"sku":"([A-Z0-9]+)","partNumber":"([A-Z0-9/]+)","price":\{"fullPrice":([0-9.]+)\}(?:,"[^"]+":"[^"]*")*,"name":"([^"]+)"/g;

/**
 * Apple serves this block in two shapes depending on the rendering path:
 * raw JSON inside a <script>, and JSON-escaped inside an HTML attribute
 * (\"sku\":\"MJY04\"). Both are scanned so a change on Apple's side does not
 * silently empty the catalogue.
 */
const candidateSources = (html: string): string[] => {
  const unescaped = html.replace(/\\"/g, '"');
  return unescaped === html ? [html] : [html, unescaped];
};

export const parseCatalogEntries = (html: string): AppleCatalogEntry[] => {
  const entries = new Map<string, AppleCatalogEntry>();

  for (const match of candidateSources(html).flatMap((source) => [...source.matchAll(CATALOG_ENTRY_RE)])) {
    const [, sku, partNumber, price, name] = match;
    if (!sku || !partNumber || !name) continue;
    const priceTHB = price !== undefined ? Number.parseFloat(price) : Number.NaN;
    entries.set(partNumber, {
      sku,
      partNumber,
      name: normaliseSpaces(name),
      priceTHB: Number.isFinite(priceTHB) ? priceTHB : null,
    });
  }

  return [...entries.values()];
};

/**
 * Apple writes product names with NON-BREAKING spaces ("iPhone\u00a018 Pro\u00a0Max"),
 * which silently breaks naive prefix matching. Normalise every exotic space
 * (NBSP, narrow NBSP, thin space) to a plain one before comparing.
 */
export const normaliseSpaces = (value: string): string =>
  value.replace(/[\u00a0\u2007\u202f\u2009]/g, ' ').replace(/\s+/g, ' ').trim();

const STORAGE_RE = /\b(\d+(?:GB|TB))\b/i;

/// Sortable size in GB, so "1TB" ranks above "512GB" instead of below it.
export const storageRank = (storage: string): number => {
  const match = /^(\d+)(GB|TB)$/i.exec(storage.trim());
  if (!match?.[1]) return Number.MAX_SAFE_INTEGER;
  const value = Number.parseInt(match[1], 10);
  return match[2]?.toUpperCase() === 'TB' ? value * 1024 : value;
};

/**
 * "iPhone 18 Pro Max 256GB Burgundy" -> model / storage / colour.
 * Returns null when the name does not match the requested model, so a lineup
 * change on Apple's side simply yields fewer variants instead of garbage rows.
 */
export const parseVariantName = (
  entry: AppleCatalogEntry,
  modelFilter: string,
): AppleVariant | null => {
  const name = normaliseSpaces(entry.name);
  const model = normaliseSpaces(modelFilter);
  if (!name.toLowerCase().startsWith(model.toLowerCase())) return null;

  const storageMatch = STORAGE_RE.exec(name);
  if (!storageMatch?.[1]) return null;

  const storage = storageMatch[1].toUpperCase();
  const color = name.slice(storageMatch.index + storageMatch[1].length).trim();
  if (color.length === 0) return null;

  return {
    partNumber: entry.partNumber,
    basePart: entry.sku,
    model,
    storage,
    color,
    colorTh: toThaiColor(color),
    priceTHB: entry.priceTHB,
  };
};

export const parseCatalog = (html: string, modelFilter: string): AppleVariant[] =>
  parseCatalogEntries(html)
    .map((entry) => parseVariantName(entry, modelFilter))
    .filter((variant): variant is AppleVariant => variant !== null);

/**
 * Maps Apple's `pickupDisplay` to our tri-state.
 * Anything we do not explicitly recognise becomes UNKNOWN - never UNAVAILABLE.
 */
export const toStockStatus = (pickupDisplay: string | undefined): StockStatus => {
  switch (pickupDisplay?.trim().toLowerCase()) {
    case 'available':
      return 'AVAILABLE';
    case 'unavailable':
      return 'UNAVAILABLE';
    case undefined:
      return 'UNKNOWN';
    default:
      logger.debug('Unrecognised pickupDisplay, degrading to UNKNOWN', pickupDisplay);
      return 'UNKNOWN';
  }
};

/// Apple returns "Central World"; every TH store is branded "Apple <name>".
export const toStoreDisplayName = (rawName: string): string =>
  rawName.startsWith('Apple ') ? rawName : `Apple ${rawName}`;

export const parseStore = (store: PickupStore): AppleStore => {
  const addressParts = [
    store.address?.address,
    store.address?.address2,
    store.address?.address3,
    store.address?.postalCode,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);

  return {
    code: store.storeNumber,
    name: toStoreDisplayName(store.storeName),
    rawName: store.storeName,
    city: store.city,
    province: store.state ?? store.city,
    address: addressParts.length > 0 ? addressParts.join(' ') : undefined,
    country: store.country ?? 'TH',
    latitude: store.storelatitude,
    longitude: store.storelongitude,
    storeUrl: store.reservationUrl,
  };
};

const quoteOf = (part: PartAvailability): string | undefined =>
  part.pickupSearchQuote ?? part.messageTypes?.regular?.storePickupQuote;

/**
 * pickup-message response -> ProductStock[].
 * `variants` is the authoritative catalogue: parts Apple returns that we do not
 * track are ignored, and tracked parts missing from the response are left to
 * the caller to mark UNKNOWN.
 */
export const parsePickupMessage = (
  response: PickupMessageResponse,
  variants: ReadonlyMap<string, AppleVariant>,
  checkedAt: Date = new Date(),
): { stocks: ProductStock[]; stores: AppleStore[] } => {
  const stores: AppleStore[] = [];
  const stocks: ProductStock[] = [];

  for (const rawStore of response.body.stores) {
    const store = parseStore(rawStore);
    stores.push(store);

    for (const [partNumber, part] of Object.entries(rawStore.partsAvailability)) {
      const variant = variants.get(partNumber);
      if (!variant) continue;

      const status = toStockStatus(part.pickupDisplay);
      stocks.push({
        model: variant.model,
        color: variant.color,
        colorTh: variant.colorTh,
        storage: variant.storage,
        partNumber: variant.partNumber,
        basePart: part.messageTypes?.regular?.basePartNumber ?? variant.basePart,
        priceTHB: variant.priceTHB,
        storeName: store.name,
        storeCode: store.code,
        status,
        available: status === 'AVAILABLE',
        quote: quoteOf(part),
        checkedAt,
      });
    }
  }

  return { stocks, stores };
};
