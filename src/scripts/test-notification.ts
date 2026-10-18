/**
 * Sends one test alert to every configured channel and prints what happened.
 *
 *   npm run notify:test
 *
 * Use it after adding a Discord webhook or a Telegram token to confirm the
 * wiring without waiting for stock to actually appear.
 */
import { channelDispatcher } from '../notification/channels.js';
import {
  buildPlainText,
  buildStockAlertMessage,
  buildSystemMessage,
  buildSystemPlainText,
} from '../notification/line.flex.js';
import { buildStatusMessage, readStatus } from '../notification/status.report.js';
import { disconnectPrisma } from '../database/prisma.js';
import type { StockTransition } from '../stock/stock.types.js';
import { logger } from '../utils/logger.js';
import { SEED_VARIANTS } from '../apple/apple.seed.js';

/// Test sends never go to LINE - its monthly quota is reserved for real alerts.
const NO_LINE = ['line'] as const;

/// Appended to every sample so a test can never be mistaken for real stock.
const SAMPLE_FOOTER = '\n\n— ตัวอย่างสำหรับทดสอบ ไม่ใช่การแจ้งเตือนจริง —';

/// Real iPhone Duo variants (colour, part number, price) for realistic samples.
const duoVariant = (color: string, storage: string) => {
  const variant = (SEED_VARIANTS['iphone duo'] ?? []).find(
    (entry) => entry.color === color && entry.storage === storage,
  );
  if (!variant) throw new Error(`No iPhone Duo variant ${storage} ${color}`);
  return variant;
};

const sampleTransition = (
  color: string,
  storage: string,
  storeName: string,
): StockTransition => {
  const variant = duoVariant(color, storage);
  return {
  stockId: `sample-${color}-${storage}`,
  previousStatus: 'UNAVAILABLE',
  currentStatus: 'AVAILABLE',
  stock: {
    model: variant.model,
    color: variant.color,
    colorTh: variant.colorTh,
    storage,
    partNumber: variant.partNumber,
    basePart: variant.basePart,
    priceTHB: variant.priceTHB,
    storeName,
    storeCode: 'R733',
    status: 'AVAILABLE',
    available: true,
    quote: 'พร้อมจำหน่าย วันนี้',
    checkedAt: new Date(),
  },
  };
};

/**
 * Sends one of each alert the bot can produce, so the formatting can be
 * reviewed without waiting for Apple to actually restock or block us.
 */
const sendSamples = async (): Promise<boolean> => {
  const single = [sampleTransition('Night Sky', '256GB', 'Apple Central World')];
  const multi = [
    ...single,
    sampleTransition('Star White', '512GB', 'Apple Iconsiam'),
    sampleTransition('Night Sky', '2TB', 'Apple Central World'),
  ];

  const until = new Date(Date.now() + 30 * 60_000);
  const rateLimitRows: Array<[string, string]> = [
    ['พักนาน', '30 นาที'],
    ['กลับมาตรวจ', until.toTimeString().slice(0, 5)],
    ['ล้มเหลวติดกัน', '4 ครั้ง'],
    ['หมายเหตุ', 'ระหว่างนี้ยังไม่ทราบสถานะสต็อก ไม่ใช่ว่าไม่มีของ'],
  ];

  const samples = [
    {
      label: 'มีของ 1 รายการ',
      flex: buildStockAlertMessage(single),
      text: buildPlainText(single) + SAMPLE_FOOTER,
    },
    {
      label: 'มีของ 3 รายการ',
      flex: buildStockAlertMessage(multi),
      text: buildPlainText(multi) + SAMPLE_FOOTER,
    },
    {
      label: 'Apple บล็อก (541)',
      flex: buildSystemMessage('⚠️ ระบบหยุดตรวจชั่วคราว', 'Apple ปฏิเสธคำขอ (rate limit) - พักการตรวจอัตโนมัติ', rateLimitRows, 'warn'),
      text:
        buildSystemPlainText(
          '⚠️ ระบบหยุดตรวจชั่วคราว',
          'Apple ปฏิเสธคำขอ (rate limit) - พักการตรวจอัตโนมัติ',
          rateLimitRows,
        ) + SAMPLE_FOOTER,
    },
  ];

  let allOk = true;
  logger.raw('Samples:');

  for (const sample of samples) {
    const result = await channelDispatcher.push({ flex: sample.flex, text: sample.text, excludeChannels: NO_LINE });
    const discord = result.results.find((entry) => entry.channel === 'discord');
    const status = discord?.success
      ? `✅ sent (id=${discord.messageId})`
      : `❌ ${discord?.error ?? 'discord not configured'}`;
    logger.raw(`  ${sample.label.padEnd(22)} ${status}`);
    if (!discord?.success) allOk = false;
    // Stay well clear of Discord's per-webhook rate limit.
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  logger.raw('');
  return allOk;
};

const main = async (): Promise<void> => {
  const configured = channelDispatcher.configured();

  if (configured.length === 0) {
    logger.error(
      'No notification channel configured',
      'set LINE_*, TELEGRAM_* or DISCORD_WEBHOOK_URL in .env',
    );
    process.exit(1);
  }

  logger.raw('');
  logger.raw('Channels:');
  for (const channel of configured) {
    const available = channel.isAvailable?.() ?? true;
    logger.raw(`  ${available ? '✓' : '⏸'} ${channel.name}${available ? '' : ' (paused)'}`);
  }
  logger.raw('');

  if (process.argv.includes('--status')) {
    const snapshot = await readStatus();
    const result = await channelDispatcher.push({ ...buildStatusMessage(snapshot), excludeChannels: NO_LINE });
    const discord = result.results.find((entry) => entry.channel === 'discord');
    logger.raw(
      `Status report: ${discord?.success ? `✅ sent (id=${discord.messageId})` : `❌ ${discord?.error ?? 'discord not configured'}`}`,
    );
    logger.raw('');
    await disconnectPrisma();
    process.exit(result.success ? 0 : 1);
  }

  if (process.argv.includes('--samples')) {
    const ok = await sendSamples();
    process.exit(ok ? 0 : 1);
  }

  const title = '🧪 ทดสอบการแจ้งเตือน';
  const headline = 'ถ้าเห็นข้อความนี้ แปลว่าช่องทางนี้พร้อมใช้งานแล้ว';
  const rows: Array<[string, string]> = [
    ['สถานะ', 'ทดสอบระบบ ไม่ใช่การแจ้งเตือนสต็อกจริง'],
    ['รอบตรวจ', `ทุก ${process.env.STOCK_CHECK_INTERVAL_SECONDS ?? '30'} วินาที`],
  ];

  const result = await channelDispatcher.push({
    flex: buildSystemMessage(title, headline, rows, 'ok'),
    text: buildSystemPlainText(title, headline, rows),
  });

  logger.raw('');
  logger.raw('Result:');
  for (const channelResult of result.results) {
    if (channelResult.skipped) {
      logger.raw(`  ⏭  ${channelResult.channel} - skipped (not configured)`);
    } else if (channelResult.success) {
      logger.raw(`  ✅ ${channelResult.channel} - sent (id=${channelResult.messageId ?? 'n/a'})`);
    } else {
      logger.raw(`  ❌ ${channelResult.channel} - ${channelResult.error ?? 'failed'}`);
    }
  }
  logger.raw('');

  // Non-zero exit when nothing got through, so this is usable in a health check.
  process.exit(result.success ? 0 : 1);
};

main().catch((error: unknown) => {
  logger.error('Test notification failed', error);
  process.exit(1);
});
