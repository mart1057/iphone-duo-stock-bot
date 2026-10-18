import { toThaiColor } from './apple.parser.js';
import type { AppleVariant } from './apple.types.js';

/**
 * Known iPhone Duo part numbers (TH), used ONLY when the buy page cannot be
 * fetched or parsed. pickup-message needs nothing but part numbers, so the
 * monitor keeps working even if Apple changes the buy-page markup.
 * The live page always wins whenever it parses.
 */
const duo = (sku: string, storage: string, color: string, priceTHB: number): AppleVariant => ({
  partNumber: `${sku}ZP/A`,
  basePart: sku,
  model: 'iPhone Duo',
  storage,
  color,
  colorTh: toThaiColor(color),
  priceTHB,
});

export const SEED_VARIANTS: Readonly<Record<string, AppleVariant[]>> = {
  'iphone duo': [
    duo('MK2D4', '256GB', 'Star White', 79900),
    duo('MK2E4', '256GB', 'Night Sky', 79900),
    duo('MK2F4', '512GB', 'Star White', 87900),
    duo('MK2G4', '512GB', 'Night Sky', 87900),
    duo('MK2H4', '1TB', 'Star White', 103900),
    duo('MK2J4', '1TB', 'Night Sky', 103900),
    duo('MK2K4', '2TB', 'Star White', 127900),
    duo('MK2L4', '2TB', 'Night Sky', 127900),
  ],
};

export const seedVariantsFor = (model: string): AppleVariant[] =>
  (SEED_VARIANTS[model.trim().toLowerCase()] ?? []).map((variant) => ({ ...variant }));
