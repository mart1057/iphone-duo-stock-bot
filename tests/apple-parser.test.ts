import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COLOR_EN_TO_TH,
  parseCatalog,
  parseCatalogEntries,
  parsePickupMessage,
  parseStore,
  parseVariantName,
  normaliseSpaces,
  storageRank,
  toStockStatus,
  toStoreDisplayName,
} from '../src/apple/apple.parser.js';
import { pickupMessageResponseSchema, type AppleVariant } from '../src/apple/apple.types.js';

const fixturePath = fileURLToPath(new URL('./fixtures/pickup-message.json', import.meta.url));
const loadFixture = (): unknown => JSON.parse(readFileSync(fixturePath, 'utf8'));

/// A verbatim slice of the real buy-flow HTML from apple.com/th (2026-09-18).
const BUY_PAGE_HTML = `"products":[{"sku":"MJY04","partNumber":"MJY04ZP/A","price":{"fullPrice":76900.00},"category":"iphone","name":"iPhone 18 Pro Max 1TB Burgundy"},{"sku":"MJXQ4","partNumber":"MJXQ4ZP/A","price":{"fullPrice":52900.00},"category":"iphone","name":"iPhone 18 Pro Max 256GB Burgundy"},{"sku":"MJY54","partNumber":"MJY54ZP/A","price":{"fullPrice":100900.00},"category":"iphone","name":"iPhone 18 Pro Max 2TB Glacier"},{"sku":"MJRP4","partNumber":"MJRP4ZP/A","price":{"fullPrice":48900.00},"category":"iphone","name":"iPhone 18 Pro 256GB Black"}]`;

const variantMap = (variants: AppleVariant[]): Map<string, AppleVariant> =>
  new Map(variants.map((variant) => [variant.partNumber, variant]));

describe('catalogue parser', () => {
  it('extracts every product entry from the buy-flow HTML', () => {
    const entries = parseCatalogEntries(BUY_PAGE_HTML);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      sku: 'MJY04',
      partNumber: 'MJY04ZP/A',
      name: 'iPhone 18 Pro Max 1TB Burgundy',
      priceTHB: 76900,
    });
  });

  it('keeps only the requested model', () => {
    const variants = parseCatalog(BUY_PAGE_HTML, 'iPhone 18 Pro Max');
    expect(variants).toHaveLength(3);
    expect(variants.map((variant) => variant.partNumber)).not.toContain('MJRP4ZP/A');
  });

  it('splits name into storage and colour and maps colour to Thai', () => {
    const variant = parseVariantName(
      { sku: 'MJXQ4', partNumber: 'MJXQ4ZP/A', name: 'iPhone 18 Pro Max 256GB Burgundy', priceTHB: 52900 },
      'iPhone 18 Pro Max',
    );

    expect(variant).toMatchObject({
      model: 'iPhone 18 Pro Max',
      storage: '256GB',
      color: 'Burgundy',
      colorTh: 'เบอร์กันดี',
      basePart: 'MJXQ4',
      priceTHB: 52900,
    });
  });

  it('maps all tracked colours to Thai', () => {
    expect(COLOR_EN_TO_TH).toEqual({
      Black: 'ดำ',
      Silver: 'เงิน',
      Glacier: 'ธารน้ำแข็ง',
      Burgundy: 'เบอร์กันดี',
      'Star White': 'สตาร์ไวท์',
      'Night Sky': 'ไนท์สกาย',
    });
  });

  it('survives the non-breaking spaces Apple actually ships', () => {
    // Verbatim from apple.com/th: "iPhone\u00a018 Pro\u00a0Max".
    const nbspHtml =
      '{"sku":"MJXQ4","partNumber":"MJXQ4ZP/A","price":{"fullPrice":52900.00},"category":"iphone","name":"iPhone\u00a018 Pro\u00a0Max 256GB Burgundy"}';
    const variants = parseCatalog(nbspHtml, 'iPhone 18 Pro Max');

    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ storage: '256GB', color: 'Burgundy', colorTh: 'เบอร์กันดี' });
  });

  it('returns null for a different model', () => {
    expect(
      parseVariantName(
        { sku: 'MJRP4', partNumber: 'MJRP4ZP/A', name: 'iPhone 18 Pro 256GB Black', priceTHB: 48900 },
        'iPhone 18 Pro Max',
      ),
    ).toBeNull();
  });
});

describe('whitespace normalisation', () => {
  it('collapses NBSP and friends', () => {
    expect(normaliseSpaces('iPhone\u00a018 Pro\u00a0Max')).toBe('iPhone 18 Pro Max');
    expect(normaliseSpaces('  a\u202fb  ')).toBe('a b');
  });
});

describe('storage ordering', () => {
  it('ranks 1TB above 512GB', () => {
    expect([...['1TB', '256GB', '2TB', '512GB']].sort((a, b) => storageRank(a) - storageRank(b))).toEqual([
      '256GB',
      '512GB',
      '1TB',
      '2TB',
    ]);
  });
});

describe('pickupDisplay -> StockStatus', () => {
  it('maps the two documented values', () => {
    expect(toStockStatus('available')).toBe('AVAILABLE');
    expect(toStockStatus('unavailable')).toBe('UNAVAILABLE');
  });

  it('never turns an unknown or missing value into UNAVAILABLE', () => {
    expect(toStockStatus(undefined)).toBe('UNKNOWN');
    expect(toStockStatus('')).toBe('UNKNOWN');
    expect(toStockStatus('ineligible')).toBe('UNKNOWN');
    expect(toStockStatus('something-apple-invented')).toBe('UNKNOWN');
  });
});

describe('store parser', () => {
  it('brands the store name and flattens the address', () => {
    const response = pickupMessageResponseSchema.parse(loadFixture());
    const store = parseStore(response.body.stores[0]!);

    expect(store.code).toMatch(/^R\d+$/);
    expect(store.name.startsWith('Apple ')).toBe(true);
    expect(store.country).toBe('TH');
    expect(typeof store.address).toBe('string');
  });

  it('does not double-prefix an already branded name', () => {
    expect(toStoreDisplayName('Apple Iconsiam')).toBe('Apple Iconsiam');
    expect(toStoreDisplayName('Central World')).toBe('Apple Central World');
  });
});

describe('pickup-message -> ProductStock[] (real Apple response)', () => {
  const variants = variantMap(parseCatalog(BUY_PAGE_HTML, 'iPhone 18 Pro Max'));

  it('produces one ProductStock per tracked (variant x store)', () => {
    const response = pickupMessageResponseSchema.parse(loadFixture());
    const { stocks, stores } = parsePickupMessage(response, variants);

    expect(stores.length).toBeGreaterThanOrEqual(2);
    // Fixture holds 3 parts, 2 of which are in our 3-variant catalogue.
    expect(stocks.length).toBe(stores.length * 2);

    for (const stock of stocks) {
      expect(stock.model).toBe('iPhone 18 Pro Max');
      expect(['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN']).toContain(stock.status);
      expect(stock.available).toBe(stock.status === 'AVAILABLE');
      expect(stock.storeCode).toMatch(/^R\d+$/);
      expect(stock.checkedAt).toBeInstanceOf(Date);
    }
  });

  it('normalises an AVAILABLE part into the shared model', () => {
    const payload = loadFixture() as {
      body: { stores: Array<{ partsAvailability: Record<string, { pickupDisplay: string }> }> };
    };
    const firstStore = payload.body.stores[0]!;
    firstStore.partsAvailability['MJXQ4ZP/A']!.pickupDisplay = 'available';

    const response = pickupMessageResponseSchema.parse(payload);
    const { stocks } = parsePickupMessage(response, variants);
    const hit = stocks.find((stock) => stock.partNumber === 'MJXQ4ZP/A');

    expect(hit).toMatchObject({
      model: 'iPhone 18 Pro Max',
      color: 'Burgundy',
      colorTh: 'เบอร์กันดี',
      storage: '256GB',
      status: 'AVAILABLE',
      available: true,
    });
  });

  it('ignores parts that are not in the tracked catalogue', () => {
    const response = pickupMessageResponseSchema.parse(loadFixture());
    const { stocks } = parsePickupMessage(response, new Map());
    expect(stocks).toHaveLength(0);
  });

  it('degrades a malformed store payload to UNKNOWN instead of crashing', () => {
    const response = pickupMessageResponseSchema.parse({
      head: { status: '200' },
      body: {
        stores: [
          {
            storeNumber: 'R999',
            storeName: 'Future Store',
            partsAvailability: { 'MJXQ4ZP/A': { partNumber: 'MJXQ4ZP/A' } },
          },
        ],
      },
    });

    const { stocks } = parsePickupMessage(response, variants);
    expect(stocks[0]?.status).toBe('UNKNOWN');
    expect(stocks[0]?.available).toBe(false);
  });
});

describe('iPhone Duo catalogue', () => {
  it('parses Duo variants with Thai colours', () => {
    const html =
      '{"sku":"MK2D4","partNumber":"MK2D4ZP/A","price":{"fullPrice":79900.00},"category":"iphone","name":"iPhone\u00a0Duo 256GB Star White"},' +
      '{"sku":"MK2L4","partNumber":"MK2L4ZP/A","price":{"fullPrice":127900.00},"category":"iphone","name":"iPhone Duo 2TB Night Sky"}';
    const variants = parseCatalog(html, 'iPhone Duo');
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({ model: 'iPhone Duo', storage: '256GB', color: 'Star White', colorTh: 'สตาร์ไวท์', priceTHB: 79900 });
    expect(variants[1]).toMatchObject({ storage: '2TB', color: 'Night Sky', colorTh: 'ไนท์สกาย' });
  });
});
