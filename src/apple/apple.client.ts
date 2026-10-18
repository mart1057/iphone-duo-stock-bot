import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import {
  AppleRequestError,
  pickupMessageResponseSchema,
  type PickupMessageResponse,
} from './apple.types.js';

/// Same UA a normal Safari on macOS sends. We do not spoof anything else and
/// we do not attempt to defeat any protection - if Apple blocks us we report it.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const PICKUP_MESSAGE_PATH = '/th/shop/retail/pickup-message';

/// 4xx (other than 408/429) will not become healthy by retrying.
const isRetryableError = (error: unknown): boolean => {
  if (error instanceof AppleRequestError) return error.retryable;
  return true;
};

const buildUrl = (parts: readonly string[], postalCode: string): string => {
  const url = new URL(PICKUP_MESSAGE_PATH, 'https://www.apple.com');
  parts.forEach((part, index) => url.searchParams.set(`parts.${index}`, part));
  // NOTE: parameter ORDER matters - Apple returns an empty body when `location`
  // precedes the `parts.N` keys. URLSearchParams preserves insertion order.
  url.searchParams.set("little", "false");
  url.searchParams.set('location', postalCode);
  return url.toString();
};

const request = async (url: string, accept: string): Promise<Response> => {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(env.REQUEST_TIMEOUT_MS),
    headers: {
      'User-Agent': USER_AGENT,
      Accept: accept,
      'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
      Referer: env.APPLE_PRODUCT_URL,
    },
  });

  if (!response.ok) {
    const retryable =
      response.status >= 500 || response.status === 408 || response.status === 429;
    throw new AppleRequestError(
      `Apple request failed status=${response.status} url=${url}`,
      response.status,
      retryable,
    );
  }

  return response;
};

export class AppleClient {
  /**
   * Availability for up to `APPLE_MAX_PARTS_PER_REQUEST` part numbers across
   * every Apple Store near `postalCode`, in a single request.
   */
  async getPickupMessage(
    parts: readonly string[],
    postalCode: string,
  ): Promise<PickupMessageResponse> {
    if (parts.length === 0) {
      throw new AppleRequestError('getPickupMessage called with no part numbers', undefined, false);
    }

    const url = buildUrl(parts, postalCode);

    return withRetry(
      async () => {
        const started = Date.now();
        const response = await request(url, 'application/json, text/plain, */*');
        const payload: unknown = await response.json();
        const parsed = pickupMessageResponseSchema.safeParse(payload);

        if (!parsed.success) {
          // Shape drift: treat as retryable once, then the caller degrades to UNKNOWN.
          throw new AppleRequestError(
            `Unexpected pickup-message shape: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
            response.status,
            false,
          );
        }

        logger.debug('pickup-message ok', {
          postalCode,
          parts: parts.length,
          stores: parsed.data.body.stores.length,
          ms: Date.now() - started,
        });

        return parsed.data;
      },
      {
        retries: env.MAX_RETRIES,
        baseDelayMs: env.RETRY_BASE_DELAY_MS,
        label: `Apple pickup-message (${parts.length} parts @ ${postalCode})`,
        isRetryable: isRetryableError,
      },
    );
  }

  /// Raw HTML of the buy-flow page, used to discover part numbers.
  async getProductPageHtml(): Promise<string> {
    return withRetry(
      async () => {
        const response = await request(env.APPLE_PRODUCT_URL, 'text/html,*/*');
        return response.text();
      },
      {
        retries: env.MAX_RETRIES,
        baseDelayMs: env.RETRY_BASE_DELAY_MS,
        label: 'Apple product page',
        isRetryable: isRetryableError,
      },
    );
  }
}

export const appleClient = new AppleClient();
