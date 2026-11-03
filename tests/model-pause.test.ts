import { describe, expect, it, vi } from 'vitest';
import { AppleAvailabilityCollector } from '../src/apple/apple.availability.js';

const variant = (model: string, partNumber: string) => ({
  model, partNumber, basePart: partNumber.slice(0, 5), color: 'Black', colorTh: 'ดำ', storage: '256GB', priceTHB: null,
});

describe('paused models', () => {
  const catalog = { getVariants: vi.fn(async () => [variant('iPhone Duo', 'MK2E4ZP/A'), variant('iPhone 18 Pro Max', 'MJXQ4ZP/A')]) };

  it('leaves a paused model out of the Apple request', async () => {
    const client = { getPickupMessage: vi.fn(async () => ({ body: { stores: [] } })) };
    const collector = new AppleAvailabilityCollector(client as never, catalog as never, async () => new Set(['iPhone 18 Pro Max']));
    const snapshot = await collector.collect();
    expect(client.getPickupMessage).toHaveBeenCalledTimes(1);
    expect(client.getPickupMessage.mock.calls[0]![0]).toEqual(['MK2E4ZP/A']);
    expect(snapshot.variants.map((v) => v.model)).toEqual(['iPhone Duo']);
  });

  it('makes no Apple request at all when every model is paused', async () => {
    const client = { getPickupMessage: vi.fn() };
    const collector = new AppleAvailabilityCollector(client as never, catalog as never,
      async () => new Set(['iPhone Duo', 'iPhone 18 Pro Max']));
    const snapshot = await collector.collect();
    expect(client.getPickupMessage).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({ stocks: [], errors: [], rateLimited: false });
  });
});
