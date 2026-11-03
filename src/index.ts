import { checkWindow } from './scheduler/check-window.js';
import { seedVariantsFor } from './apple/apple.seed.js';
import { appleCatalog } from './apple/apple.catalog.js';
import { storageRank } from './apple/apple.parser.js';
import {
  env,
  monitoredModelsLabel,
  isAnyChannelConfigured,
  isDiscordConfigured,
  isLineConfigured,
  isTelegramConfigured,
} from './config/env.js';
import { disconnectPrisma, prisma } from './database/prisma.js';
import { stockScheduler } from './scheduler/stock.scheduler.js';
import { historyScheduler } from './scheduler/history.scheduler.js';
import { memberExpiryScheduler } from './scheduler/member-expiry.scheduler.js';
import { telegramCommandService } from './notification/telegram.commands.js';
import { logger } from './utils/logger.js';
import { startAdminServer } from './admin/admin.server.js';

const banner = async (): Promise<void> => {
  const variants = checkWindow().open
    ? await appleCatalog.getVariants()
    : env.appleProducts.flatMap((product) => seedVariantsFor(product.model));
  const colors = [...new Set(variants.map((variant) => variant.color))];
  const storages = [...new Set(variants.map((variant) => variant.storage))].sort(
    (a, b) => storageRank(a) - storageRank(b),
  );

  const schedule =
    env.STOCK_CHECK_CRON.length > 0
      ? `cron "${env.STOCK_CHECK_CRON}"`
      : `08:00–09:00 Bangkok: random 10–15 seconds; otherwise 30 seconds`;

  logger.raw('');
  logger.raw(`🍎 ${monitoredModelsLabel()} Stock Bot`);
  logger.raw('');
  logger.raw('Models:');
  for (const product of env.appleProducts) {
    const count = variants.filter((variant) => variant.model === product.model).length;
    logger.raw(`✓ ${product.model} (${count} variants) ${product.url}`);
  }
  logger.raw('');
  logger.raw('Colors:');
  for (const color of colors) logger.raw(`✓ ${color}`);
  logger.raw('');
  logger.raw('Storage:');
  for (const storage of storages) logger.raw(`✓ ${storage}`);
  logger.raw('');
  logger.raw('Stores:');
  logger.raw('✓ Apple Store Thailand (discovered from Apple, not hard-coded)');
  logger.raw('');
  logger.raw('Interval:');
  logger.raw(schedule);
  logger.raw('');
  logger.raw('Channels:');
  const channels = [
    ['LINE', isLineConfigured()],
    ['Telegram', isTelegramConfigured()],
    ['Discord', isDiscordConfigured()],
  ] as const;
  for (const [name, on] of channels) logger.raw(`${on ? '✓' : '✗'} ${name}`);
  logger.raw('');
  logger.raw('Status:');
  logger.raw(
    isAnyChannelConfigured() || env.LINE_DRY_RUN
      ? '🟢 Monitoring'
      : '🟡 Monitoring (no notification channel configured)',
  );
  logger.raw('');
};

let adminServer: ReturnType<typeof startAdminServer> = null;

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal} - shutting down`);
  adminServer?.close();
  await telegramCommandService.stop();
  await stockScheduler.stop();
  await historyScheduler.stop();
  await memberExpiryScheduler.stop();
  await disconnectPrisma();
  process.exit(0);
};

const main = async (): Promise<void> => {
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Database connection ok');

  if (!isAnyChannelConfigured() && !env.LINE_DRY_RUN) {
    logger.warn(
      'No notification channel configured - stock will be tracked but no alerts will be sent',
      'set LINE_*, TELEGRAM_* or DISCORD_WEBHOOK_URL',
    );
  }

  await banner();

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  telegramCommandService.start();
  await stockScheduler.start();
  historyScheduler.start();
  memberExpiryScheduler.start();
  adminServer = startAdminServer();
};

main().catch(async (error: unknown) => {
  logger.error('Fatal startup error', error);
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
});
