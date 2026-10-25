import { env } from '../config/env.js';

const OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Daily Bangkok window: 05:30 inclusive, 22:00 exclusive, independent of host TZ. */
export const checkWindow = (now = Date.now()) => {
  const local = new Date(now + OFFSET_MS);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET_MS;
  const start = midnight + (5 * 60 + 30) * 60_000;
  const end = midnight + 22 * 60 * 60_000;
  return {
    open: !env.STOCK_CHECK_WINDOW_ENABLED || (now >= start && now < end),
    nextOpenMs: now < start ? start : start + DAY_MS,
    closesInMs: end - now,
  };
};
