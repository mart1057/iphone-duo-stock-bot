import { describe, expect, it, vi } from 'vitest';
import { AppleCatalog } from '../src/apple/apple.catalog.js';

const entry = (sku: string, name: string, price = 52900) =>
  `{"sku":"${sku}","partNumber":"${sku}ZP/A","price":{"fullPrice":${price}.00},"name":"${name}"}`;

const pages: Record<string, string> = {
  'https://example.test/duo': entry('MK2E4', 'iPhone Duo 256GB Night Sky') + entry('MK2L4', 'iPhone Duo 2TB Night Sky'),
  // The Pro page lists both models; only "Pro Max" must be picked up.
  'https://example.test/pro':
    entry('MJXQ4', 'iPhone 18 Pro Max 256GB Burgundy') +
    entry('MJY04', 'iPhone 18 Pro Max 2TB Black') +
    entry('MJAA4', 'iPhone 18 Pro 256GB Burgundy'),
};

const products = [
  { model: 'iPhone Duo', url: 'https://example.test/duo' },
  { model: 'iPhone 18 Pro Max', url: 'https://example.test/pro' },
];

describe('AppleCatalog with several models', () => {
  it('keeps "iPhone 18 Pro" and "iPhone 18 Pro Max" apart', async () => {
    const client = { getProductPageHtml: vi.fn(async () => pages['https://example.test/pro']!) };
    const variants = await new AppleCatalog(client as never, () => [
      { model: 'iPhone 18 Pro', url: 'https://example.test/pro' },
    ]).getVariants();
    expect(variants.map((v) => v.partNumber)).toEqual(['MJAA4ZP/A']);
  });

  it('loads each model from its own page and ignores other models on that page', async () => {
    const client = { getProductPageHtml: vi.fn(async (url: string) => pages[url] ?? '') };
    const variants = await new AppleCatalog(client as never, () => products).getVariants();
    expect(client.getProductPageHtml.mock.calls.map(([url]) => url)).toEqual(products.map((p) => p.url));
    expect(variants.map((v) => `${v.model} | ${v.storage} | ${v.color}`)).toEqual([
      'iPhone Duo | 256GB | Night Sky',
      'iPhone Duo | 2TB | Night Sky',
      'iPhone 18 Pro Max | 256GB | Burgundy',
      'iPhone 18 Pro Max | 2TB | Black',
    ]);
  });

  it('keeps the other models when one page fails', async () => {
    const client = {
      getProductPageHtml: vi.fn(async (url: string) => {
        if (url.endsWith('/pro')) throw new Error('boom');
        return pages[url] ?? '';
      }),
    };
    const variants = await new AppleCatalog(client as never, () => products).getVariants();
    expect(new Set(variants.map((v) => v.model))).toEqual(new Set(['iPhone Duo']));
  });
});
