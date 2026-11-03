import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...actual, isMultiModel: () => true };
});

import { buildAlertSamples } from '../src/scripts/alert-samples.js';

describe('notify:samples scenarios', () => {
  it('render through the real pipeline, one message per model', async () => {
    const samples = await buildAlertSamples();
    expect(samples.map((s) => s.texts.length)).toEqual([1, 1, 1, 1, 2, 2]);
    const [duo, proMax] = samples[4]!.texts;
    expect(duo).toContain('📱 iPhone Duo\n🔔 เพิ่งเข้า 2 รายการ');
    expect(proMax).toContain('📱 iPhone 18 Pro Max\n🔔 เพิ่งเข้า 3 รายการ');
    expect(samples[5]!.texts[1]).toContain('🔕 ซ่อนอีก 1 รายการที่คุณปิดการเตือนไว้');
  });

  it('lists sizes smallest first within a branch', async () => {
    const text = (await buildAlertSamples())[1]!.texts[0]!;
    expect(text.indexOf('512GB')).toBeLessThan(text.indexOf('1TB'));
  });
});
