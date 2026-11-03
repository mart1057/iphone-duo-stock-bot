/**
 * Sends one test alert to every configured channel and prints what happened.
 *
 *   npm run notify:test
 *
 * Use it after adding a Discord webhook or a Telegram token to confirm the
 * wiring without waiting for stock to actually appear.
 */
import { channelDispatcher } from '../notification/channels.js';
import { buildSystemMessage, buildSystemPlainText } from '../notification/line.flex.js';
import { telegramNotificationService } from '../notification/telegram.service.js';
import { env, isTelegramConfigured } from '../config/env.js';
import { buildAlertSamples, type PartNumberLookup } from './alert-samples.js';
import { restockHistoryRepository } from '../stock/restock.history.js';
import { buildStatusMessage, readStatus } from '../notification/status.report.js';
import { disconnectPrisma } from '../database/prisma.js';
import { logger } from '../utils/logger.js';

/// Test sends never go to LINE - its monthly quota is reserved for real alerts.
const NO_LINE = ['line'] as const;

/// Appended to every sample so a test can never be mistaken for real stock.
const SAMPLE_FOOTER = '\n\n— ตัวอย่างสำหรับทดสอบ ไม่ใช่การแจ้งเตือนจริง —';

/**
 * Sends every restock scenario (1 item ... many, one model ... both models at
 * once) exactly as the bot would render it, so the layout can be reviewed.
 * Telegram: owner chats (TELEGRAM_CHAT_ID) only - invited members never get
 * test messages. Discord: the webhook. LINE: never (its quota is for real alerts).
 */
const sendSamples = async (): Promise<boolean> => {
  // Real part numbers from the database, so every sample link opens the right SKU.
  let lookup: PartNumberLookup | undefined;
  try {
    const skus = await restockHistoryRepository.listSkus();
    lookup = (model, color, storage) =>
      skus.find((sku) => sku.model === model && sku.color === color && sku.storage === storage)?.partNumber;
  } catch {
    logger.warn('Could not read part numbers - sample links use the built-in iPhone Duo list only');
  }
  const samples = await buildAlertSamples(lookup);
  let allOk = true;
  logger.raw('Samples:');

  for (const sample of samples) {
    for (const [index, body] of sample.texts.entries()) {
      const part = sample.texts.length > 1 ? ` (ข้อความ ${index + 1}/${sample.texts.length})` : '';
      const text = `🧪 ตัวอย่าง ${sample.label}${part}\n\n${body}${SAMPLE_FOOTER}`;

      const telegram = await Promise.all(
        env.telegramChatIds.map((chatId) => telegramNotificationService.sendUnchecked(chatId, text)),
      );
      const discord = (await channelDispatcher.push({
        flex: buildSystemMessage('🧪', 'sample', [], 'ok'),
        text,
        excludeChannels: ['line', 'telegram'],
      })).results.find((entry) => entry.channel === 'discord');

      const status = [
        isTelegramConfigured() ? `telegram ${telegram.every(Boolean) ? '✅' : '❌'}` : 'telegram -',
        discord ? `discord ${discord.success ? '✅' : '❌'}` : 'discord -',
      ].join('  ');
      logger.raw(`  ${(sample.label.slice(0, 2) + part).padEnd(18)} ${status}`);
      if (telegram.some((ok) => !ok) || (discord && !discord.success)) allOk = false;
      // Stay well clear of Telegram / Discord per-chat rate limits.
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
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
    ['รอบตรวจ', `08:00–09:00 น. สุ่ม 10–15 วินาที ช่วงอื่น 30 วินาที (เวลาไทย)`],
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
