import 'dotenv/config';
import { z } from 'zod';

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const booleanish = z
  .string()
  .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  LINE_CHANNEL_ACCESS_TOKEN: z.string().default(''),
  LINE_USER_ID: z.string().default(''),
  LINE_DRY_RUN: booleanish.default('false'),

  /// Telegram Bot API - free, no monthly message quota.
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
  TELEGRAM_DRY_RUN: booleanish.default('false'),
  TELEGRAM_PAYMENT_QR_PATH: z.string().default('assets/payment-qr.jpg'),
  /// Secret in the invite link t.me/<bot>?start=<code>. Empty = invites off.
  /// Change it to stop the old link working (people already in stay in).
  TELEGRAM_INVITE_CODE: z
    .string()
    .default('')
    .refine((value) => value === '' || /^[A-Za-z0-9_-]{8,64}$/.test(value),
      'Use 8-64 characters: A-Z a-z 0-9 _ -'),

  /// Discord incoming webhook(s) - free, no bot registration needed.
  DISCORD_WEBHOOK_URL: z.string().default(''),
  DISCORD_PROXY_LOG_ENABLED: booleanish.default('true'),
  DISCORD_DRY_RUN: booleanish.default('false'),

  APPLE_BASE_URL: z.string().url().default('https://www.apple.com/th/'),
  APPLE_PROXY_URL: z.string().default('').refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }, 'Use an HTTP(S) proxy URL without credentials'),
  DATAIMPULSE_USERNAME: z.string().default(''),
  DATAIMPULSE_PASSWORD: z.string().default(''),
  APPLE_PRODUCT_URL: z
    .string()
    .url()
    .default('https://www.apple.com/th/shop/buy-iphone/iphone-duo'),
  APPLE_MODEL_FILTER: z.string().default('iPhone Duo'),
  /// Several models: "Model|buy-page URL;Model|URL". Empty = the single
  /// APPLE_MODEL_FILTER + APPLE_PRODUCT_URL pair above.
  APPLE_PRODUCTS: z.string().default(''),
  APPLE_POSTAL_CODES: z.string().default('10330'),
  APPLE_MAX_PARTS_PER_REQUEST: z.coerce.number().int().min(1).max(50).default(16),
  APPLE_CATALOG_TTL_MINUTES: z.coerce.number().int().min(1).default(1440),

  STOCK_CHECK_WINDOW_ENABLED: booleanish.default('true'),
  STOCK_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  STOCK_CHECK_CRON: z.string().default(''),
  RUN_ON_STARTUP: booleanish.default('true'),

  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(50).default(500),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(20).default(3),

  RATE_LIMIT_TRIGGER_FAILURES: z.coerce.number().int().min(1).max(10).default(1),
  RATE_LIMIT_COOLDOWN_BASE_SECONDS: z.coerce.number().int().min(10).default(900),
  RATE_LIMIT_COOLDOWN_MAX_SECONDS: z.coerce.number().int().min(60).default(900),
  RATE_LIMIT_ALERT_ENABLED: booleanish.default('true'),
  /// Floor between two system notices (cooldown / recovery). Without this a
  /// flapping upstream ping-pongs cooldown -> recover -> cooldown and burns
  /// the message quota on status chatter instead of stock alerts.
  SYSTEM_ALERT_MIN_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(30),

  /// How long restock / sold-out events are kept for the Telegram /history
  /// menu. Other history (UNKNOWN rows, notification logs) is kept 72 hours.
  RESTOCK_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(3).max(730).default(180),

  /// Hour of day (Bangkok, 0-23) from which members whose expiry date is
  /// today are removed and admins get the report.
  MEMBER_EXPIRY_CHECK_HOUR: z.coerce.number().int().min(0).max(23).default(9),

  /// Web admin UI (member summary & management). 0 = off.
  ADMIN_PORT: z.coerce.number().int().min(0).max(65535).default(3008),
  ADMIN_HOST: z.string().default('127.0.0.1'),
  /// HTTP Basic password for the admin UI (user: admin). Required when
  /// ADMIN_HOST is not a loopback address.
  ADMIN_PASSWORD: z.string().default(''),

  DISTRIBUTED_LOCK_ENABLED: booleanish.default('false'),
  LOCK_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
});

export interface AppleProductTarget {
  /// Name prefix exactly as Apple writes it, e.g. "iPhone 18 Pro Max".
  model: string;
  /// Buy page that lists this model's part numbers.
  url: string;
}

const parseProducts = (value: string): AppleProductTarget[] =>
  value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [model = '', url = ''] = entry.split('|').map((part) => part.trim());
      return { model, url };
    });

const parsed = schema.superRefine((config, context) => {
  for (const product of parseProducts(config.APPLE_PRODUCTS)) {
    let validUrl = false;
    try {
      validUrl = new URL(product.url).protocol === 'https:';
    } catch { /* reported below */ }
    if (!product.model || !validUrl) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['APPLE_PRODUCTS'],
        message: 'Use "Model|https://www.apple.com/th/shop/buy-iphone/..." entries separated by ";"' });
    }
  }
  if (config.APPLE_PROXY_URL && (!config.DATAIMPULSE_USERNAME || !config.DATAIMPULSE_PASSWORD)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['APPLE_PROXY_URL'],
      message: 'Proxy requires DATAIMPULSE_USERNAME and DATAIMPULSE_PASSWORD' });
  }
}).safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  /// Every model being monitored, in display order.
  appleProducts: (() => {
    const list = parseProducts(raw.APPLE_PRODUCTS);
    const products = list.length > 0 ? list : [{ model: raw.APPLE_MODEL_FILTER, url: raw.APPLE_PRODUCT_URL }];
    // The same model twice would double every request and every alert.
    return products.filter((p, i) => products.findIndex((q) => q.model.toLowerCase() === p.model.toLowerCase()) === i);
  })() as readonly AppleProductTarget[],
  /// Seed postcodes used to discover Apple Stores.
  applePostalCodes: csv(raw.APPLE_POSTAL_CODES),
  /// LINE push targets (userId / groupId / roomId).
  lineRecipients: csv(raw.LINE_USER_ID),
  /// Telegram ADMIN chats: always get alerts and may pause / resume checks
  /// and manage subscribers. Invited people are stored in the database.
  telegramChatIds: csv(raw.TELEGRAM_CHAT_ID),
  /// Discord webhook endpoints.
  discordWebhookUrls: csv(raw.DISCORD_WEBHOOK_URL),
} as const;

export type Env = typeof env;

/// Every channel is optional at boot so the collector can be exercised
/// without any of them configured.
export const isLineConfigured = (): boolean =>
  env.LINE_CHANNEL_ACCESS_TOKEN.length > 0 && env.lineRecipients.length > 0;

export const isTelegramConfigured = (): boolean =>
  env.TELEGRAM_BOT_TOKEN.length > 0 && env.telegramChatIds.length > 0;

export const isDiscordConfigured = (): boolean => env.discordWebhookUrls.length > 0;

/// True when at least one channel can actually deliver an alert.
export const isAnyChannelConfigured = (): boolean =>
  isLineConfigured() || isTelegramConfigured() || isDiscordConfigured();

/// Buy page for a model - used for the "open Apple Store" buttons.
export const productUrlFor = (model: string | undefined): string =>
  env.appleProducts.find((product) => product.model === model)?.url ?? env.appleProducts[0]?.url ?? env.APPLE_PRODUCT_URL;

/// "iPhone Duo, iPhone 18 Pro Max" - for headings and status lines.
export const monitoredModelsLabel = (): string => env.appleProducts.map((product) => product.model).join(', ');

export const isMultiModel = (): boolean => env.appleProducts.length > 1;
