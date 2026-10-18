import { z } from 'zod';

/**
 * Shapes below are modelled on the REAL responses observed from
 * Apple Store Thailand (verified 2026-09-18):
 *
 *   GET https://www.apple.com/th/shop/retail/pickup-message
 *       ?parts.0=MJXQ4ZP%2FA&parts.1=...&little=false&location=10330
 *
 * Everything is deliberately permissive (`.passthrough()`, optional fields):
 * this is an internal Apple API with no public contract, so an unexpected
 * shape must degrade to UNKNOWN rather than crash the bot.
 */

export const partAvailabilitySchema = z
  .object({
    partNumber: z.string().optional(),
    /// Observed values: "available" | "unavailable". Anything else -> UNKNOWN.
    pickupDisplay: z.string().optional(),
    pickupSearchQuote: z.string().optional(),
    storePickEligible: z.boolean().optional(),
    messageTypes: z
      .object({
        regular: z
          .object({
            basePartNumber: z.string().optional(),
            storePickupProductTitle: z.string().optional(),
            storePickupQuote: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const storeAddressSchema = z
  .object({
    address: z.string().optional(),
    address2: z.string().optional(),
    address3: z.string().optional(),
    postalCode: z.string().optional(),
  })
  .passthrough();

export const pickupStoreSchema = z
  .object({
    storeNumber: z.string(),
    storeName: z.string(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    address: storeAddressSchema.optional(),
    storelatitude: z.number().optional(),
    storelongitude: z.number().optional(),
    reservationUrl: z.string().optional(),
    partsAvailability: z.record(z.string(), partAvailabilitySchema).default({}),
  })
  .passthrough();

export const pickupMessageResponseSchema = z
  .object({
    head: z
      .object({
        status: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
    body: z
      .object({
        stores: z.array(pickupStoreSchema).default([]),
        storesCount: z.string().optional(),
      })
      .passthrough()
      .default({ stores: [] }),
  })
  .passthrough();

export type PartAvailability = z.infer<typeof partAvailabilitySchema>;
export type PickupStore = z.infer<typeof pickupStoreSchema>;
export type PickupMessageResponse = z.infer<typeof pickupMessageResponseSchema>;

/// One entry of the buy-flow `products` array embedded in the product page HTML.
export interface AppleCatalogEntry {
  partNumber: string; // MJXQ4ZP/A
  sku: string; // MJXQ4
  name: string; // "iPhone Duo 256GB Night Sky"
  priceTHB: number | null;
}

export interface AppleVariant {
  partNumber: string;
  basePart: string;
  model: string; // "iPhone Duo"
  storage: string; // "256GB"
  color: string; // "Night Sky"
  colorTh: string; // "ไนท์สกาย"
  priceTHB: number | null;
}

export interface AppleStore {
  code: string; // "R733"
  name: string; // "Apple Central World"
  rawName: string; // "Central World"
  city?: string;
  province?: string;
  address?: string;
  country: string;
  latitude?: number;
  longitude?: number;
  storeUrl?: string;
}

/**
 * Statuses that mean "Apple is pushing back", not "the data says unavailable".
 * 541 is the status Apple's edge returns for a request it refuses to serve.
 */
export const RATE_LIMIT_STATUSES: ReadonlySet<number> = new Set([403, 429, 503, 541]);

export class AppleRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'AppleRequestError';
  }

  get isRateLimit(): boolean {
    return this.status !== undefined && RATE_LIMIT_STATUSES.has(this.status);
  }
}

export const isRateLimitError = (error: unknown): boolean =>
  error instanceof AppleRequestError && error.isRateLimit;
