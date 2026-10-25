import { env, isDiscordConfigured } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { discordNotificationService } from './discord.service.js';
import { buildSystemMessage } from './line.flex.js';

let pending = 0;
let queue = Promise.resolve();

/** Ordered Discord diagnostics; delivery never blocks Apple checks or retries. */
export const logProxyToDiscord = (detail: string): void => {
  if (!env.DISCORD_PROXY_LOG_ENABLED || !isDiscordConfigured()) return;
  if (pending >= 100) {
    logger.warn('Discord proxy log queue full - diagnostic skipped');
    return;
  }
  const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
  pending++;
  queue = queue.then(async () => {
    const result = await discordNotificationService.send({
      kind: 'system',
      text: `🔎 Apple proxy log | ${time}\n${detail}`,
      flex: buildSystemMessage('Apple proxy log', detail, [], 'ok'),
    });
    if (!result.success) logger.warn('Discord proxy log delivery failed');
  }).catch(() => logger.warn('Discord proxy log delivery failed'))
    .finally(() => { pending--; });
};
