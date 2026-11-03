import { describe, expect, it, vi } from 'vitest';

const row = (model: string, colorTh: string, available: boolean) => ({
  available,
  status: available ? 'AVAILABLE' : 'UNAVAILABLE',
  lastCheckedAt: new Date('2026-10-26T13:00:00Z'),
  store: { name: 'Apple Central World' },
  variant: { color: colorTh, colorTh, storage: '256GB', product: { model } },
});

vi.mock('../src/database/prisma.js', () => ({
  prisma: {
    stock: {
      findMany: vi.fn(async () => [
        row('iPhone Duo', 'ไนท์สกาย', true),
        row('iPhone 18 Pro Max', 'เบอร์กันดี', true), // stale: model is paused
        row('iPhone 18 Pro Max', 'ดำ', false),
      ]),
    },
  },
}));
vi.mock('../src/stock/model.pause.js', () => ({
  modelPauseStore: { pausedModels: vi.fn(async () => new Set(['iPhone 18 Pro Max'])) },
}));

import { readStatus } from '../src/notification/status.report.js';

describe('readStatus', () => {
  it('leaves paused models out, so their old stock never shows in an alert', async () => {
    const snapshot = await readStatus();
    expect(snapshot.inStock.map((item) => item.model)).toEqual(['iPhone Duo']);
    expect(snapshot.total).toBe(1);
    expect(snapshot.available).toBe(1);
  });
});
