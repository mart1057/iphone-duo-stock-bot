import { env, isTelegramConfigured } from '../config/env.js';
import { stockScheduler } from '../scheduler/stock.scheduler.js';
import { logger } from '../utils/logger.js';
import { buildStatusMessage, readStatus } from './status.report.js';
import { telegramNotificationService } from './telegram.service.js';

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number } };
}

export class TelegramCommandService {
  private controller: AbortController | null = null;
  private task: Promise<void> | null = null;
  private offset = 0;

  start(): void {
    if (this.task || !isTelegramConfigured() || env.TELEGRAM_DRY_RUN) return;
    this.controller = new AbortController();
    this.task = this.poll(this.controller.signal);
    logger.info('Telegram status commands enabled');
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    await this.task;
    this.task = null;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text) return;
    const chatId = String(message.chat.id);
    if (!env.telegramChatIds.includes(chatId)) return;
    const text = message.text.trim().toLowerCase();
    if (!/^(?:\/(?:status|start|stop|help)(?:@[a-z0-9_]+)?|status|สถานะ|เช็คสถานะ|เช็กสถานะ|สถานะการเช็ค)$/.test(text)) return;

    const command = text.split('@')[0];
    const schedule = [
      env.STOCK_CHECK_WINDOW_ENABLED
        ? '🕠 เวลาตรวจ: ทุกวัน 05:30–22:00 น. (เวลาไทย)'
        : '🕐 เวลาตรวจ: ตลอดวัน',
      env.STOCK_CHECK_CRON
        ? `รอบตรวจ: cron ${env.STOCK_CHECK_CRON}`
        : 'รอบตรวจ: สุ่มพัก 25–45 วินาทีหลังจบรอบ',
      'นอกเวลาตรวจจะไม่ส่งคำขอ Apple และรอเริ่มอัตโนมัติเมื่อถึงเวลา',
    ].filter((line) => env.STOCK_CHECK_WINDOW_ENABLED || !line.startsWith('นอกเวลา')).join('\n');
    const status = `${stockScheduler.getStatusText()}\n${schedule}`;
    if (command === '/stop' || command === '/start') {
      try {
        if (command === '/stop') {
          await stockScheduler.stop();
        } else {
          await stockScheduler.start();
        }
        await telegramNotificationService.reply(chatId,
          `${status}\n${command === '/stop'
            ? 'หยุดตรวจรอบใหม่แล้ว หากมีรอบที่กำลังตรวจจะทำจนจบ\nพิมพ์ /start เพื่อเริ่มตรวจอีกครั้ง'
            : 'เปิดการตรวจตามกำหนดแล้ว\nพิมพ์ /stop เพื่อหยุดตรวจ'}`);
      } catch {
        logger.error('Telegram scheduler command failed');
        await telegramNotificationService.reply(chatId, 'เปลี่ยนสถานะการตรวจไม่ได้ กรุณาลองใหม่ภายหลัง');
      }
      return;
    }

    let reply: string;
    try {
      const snapshot = await readStatus();
      reply = `${status}\n\n${buildStatusMessage(snapshot).text}\n\nข้อมูลจากการตรวจล่าสุด (ไม่ได้สั่งตรวจใหม่)\nพิมพ์ /status เพื่อดูสถานะ, /stop เพื่อหยุดตรวจ, /start เพื่อเริ่มตรวจ`;
    } catch {
      reply = `${status}\n\nอ่านผลตรวจล่าสุดไม่ได้ กรุณาลองใหม่ภายหลัง`;
      logger.error('Telegram status query failed');
    }
    await telegramNotificationService.reply(chatId, reply);
  }

  private async poll(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
          body: JSON.stringify({ offset: this.offset, timeout: 25, allowed_updates: ['message'] }),
        });
        if (!response.ok) throw new Error('Telegram polling failed');
        const payload = await response.json() as { ok: boolean; result?: TelegramUpdate[] };
        if (!payload.ok || !Array.isArray(payload.result)) throw new Error('Invalid Telegram response');
        for (const update of payload.result) {
          if (signal.aborted) return;
          await this.handleUpdate(update);
          this.offset = update.update_id + 1;
        }
      } catch {
        if (signal.aborted) return;
        // Do not log fetch errors: their URL can contain the bot token.
        logger.warn('Telegram command polling failed; retrying in 5 seconds (check webhook/other bot instances)');
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, 5000);
          signal.addEventListener('abort', done, { once: true });
          if (signal.aborted) done();
        });
      }
    }
  }
}

export const telegramCommandService = new TelegramCommandService();
