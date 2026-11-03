import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { env, isTelegramConfigured } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { hasAnyMute } from './alert.filter.js';
import type { ChannelResult, NotificationChannel, OutboundMessage } from './channel.types.js';
import { telegramAlertPreferences, type TelegramAlertPreferences } from './telegram.preferences.js';
import { telegramRecipients, type TelegramRecipients } from './telegram.recipients.js';

export interface InlineButton {
  text: string;
  callback_data: string;
}
export type InlineKeyboard = InlineButton[][];

/// Telegram rejects anything longer than this.
const MAX_TEXT_LENGTH = 4096;

const MD_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/// Alerts carry `[label](url)` links. Telegram only renders those in HTML
/// mode, so such texts are escaped and converted; everything else stays plain.
export const toTelegramBody = (text: string): { text: string; parse_mode?: 'HTML' } => {
  const clipped = text.slice(0, MAX_TEXT_LENGTH);
  if (!new RegExp(MD_LINK_RE.source).test(clipped)) return { text: clipped };
  const html = escapeHtml(clipped).replace(MD_LINK_RE, (_m, label: string, url: string) =>
    `<a href="${url.replace(/"/g, '&quot;')}">${label}</a>`);
  return { text: html, parse_mode: 'HTML' };
};

class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

/**
 * Telegram Bot API sender - free and without a monthly message quota, which
 * is why it exists alongside LINE rather than replacing it.
 * Docs: https://core.telegram.org/bots/api#sendmessage
 */
export class TelegramNotificationService implements NotificationChannel {
  readonly name = 'telegram';

  private botUsername: string | null = null;

  constructor(
    private readonly preferences: TelegramAlertPreferences = telegramAlertPreferences,
    private readonly recipients: TelegramRecipients = telegramRecipients,
  ) {}

  isConfigured(): boolean {
    return isTelegramConfigured();
  }

  async send(message: OutboundMessage, retryKey?: string): Promise<ChannelResult> {
    if (!this.isConfigured()) {
      return { channel: this.name, success: false, messageId: null, skipped: true };
    }

    if (env.TELEGRAM_DRY_RUN) {
      logger.warn('TELEGRAM_DRY_RUN=true - message not sent', message.flex.altText);
      return { channel: this.name, success: true, messageId: 'dry-run', skipped: false };
    }

    // The second stock copy (3 s later) is an admin-only nudge; members get
    // each restock alert exactly once.
    const allChatIds = await this.recipients.all();
    const chatIds = message.stockReminder
      ? allChatIds.filter((chatId) => this.recipients.isAdmin(chatId))
      : allChatIds;
    const texts = await this.textsFor(message, chatIds);
    const targets = chatIds.filter((chatId) => texts.get(chatId) !== null);
    if (targets.length === 0) {
      logger.info('Telegram alert skipped - every item is muted in every chat');
      return { channel: this.name, success: true, messageId: null, skipped: true };
    }

    const results = await Promise.all(
      targets.map((chatId) => this.sendTo(chatId, texts.get(chatId) ?? message.text, retryKey)),
    );

    await this.dropBlockedSubscribers(targets, results);

    const failed = results.filter((result) => !result.success);
    return {
      channel: this.name,
      success: failed.length === 0,
      messageId: results.find((result) => result.messageId)?.messageId ?? null,
      skipped: false,
      error: failed.length > 0 ? failed.map((result) => result.error).join('; ') : undefined,
    };
  }

  /// Per-chat text: chats with alert filters get a re-rendered (or no) alert.
  /// If the filters cannot be read, everyone gets the full alert - a missed
  /// restock costs more than an unwanted one.
  private async textsFor(message: OutboundMessage, chatIds: readonly string[]): Promise<Map<string, string | null>> {
    const texts = new Map<string, string | null>(chatIds.map((chatId) => [chatId, message.text]));
    if (!message.renderFiltered) return texts;
    try {
      const mutes = await this.preferences.getMutesFor(chatIds);
      for (const [chatId, chatMutes] of mutes) {
        if (hasAnyMute(chatMutes)) texts.set(chatId, message.renderFiltered(chatMutes));
      }
    } catch (error) {
      logger.warn('Could not read Telegram alert filters - sending unfiltered alert', error);
    }
    return texts;
  }

  /// A subscriber who blocked the bot or deleted their account gets 403
  /// forever; drop them instead of failing on every alert. Admins are kept.
  private async dropBlockedSubscribers(
    chatIds: readonly string[],
    results: ReadonlyArray<{ status?: number }>,
  ): Promise<void> {
    for (const [index, result] of results.entries()) {
      const chatId = chatIds[index];
      if (result.status !== 403 || !chatId || this.recipients.isAdmin(chatId)) continue;
      try {
        if (await this.recipients.remove(chatId)) {
          logger.warn(`Telegram subscriber ${maskChatId(chatId)} blocked the bot - removed`);
        }
      } catch {
        logger.warn(`Could not remove blocked Telegram subscriber ${maskChatId(chatId)}`);
      }
    }
  }

  // -- Interactive menus ----------------------------------------------------

  async sendMenu(chatId: string, text: string, keyboard: InlineKeyboard): Promise<boolean> {
    if (!(await this.canReplyTo(chatId))) return false;
    return this.sendUnchecked(chatId, text, keyboard);
  }

  /// No membership check - only for answering people who are not (or no
  /// longer) members: invite welcome / refusal, removal notice.
  async sendUnchecked(chatId: string, text: string, keyboard?: InlineKeyboard): Promise<boolean> {
    if (!this.isConfigured() || env.TELEGRAM_DRY_RUN) return false;
    return (await this.call('sendMessage', {
      chat_id: chatId,
      ...toTelegramBody(text),
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    })) !== null;
  }

  async sendPaymentQr(chatId: string, caption: string): Promise<boolean> {
    if (!this.isConfigured() || env.TELEGRAM_DRY_RUN || !env.TELEGRAM_PAYMENT_QR_PATH) return false;
    try {
      const bytes = await readFile(env.TELEGRAM_PAYMENT_QR_PATH);
      const body = new FormData();
      body.set('chat_id', chatId);
      body.set('caption', caption.slice(0, 1024));
      body.set('photo', new Blob([new Uint8Array(bytes)]), basename(env.TELEGRAM_PAYMENT_QR_PATH));
      return (await this.call('sendPhoto', body)) !== null;
    } catch {
      logger.warn('Payment QR image could not be read; sending text instructions instead');
      return false;
    }
  }

  /// Copy a submitted receipt without downloading or storing payment images.
  async copyReceipt(adminChatId: string, fromChatId: string, messageId: number): Promise<boolean> {
    if (!this.isConfigured() || env.TELEGRAM_DRY_RUN || !this.recipients.isAdmin(adminChatId)) return false;
    return (await this.call('copyMessage', {
      chat_id: adminChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    })) !== null;
  }

  /// Replaces a menu in place so tapping around does not flood the chat.
  async editMenu(chatId: string, messageId: number, text: string, keyboard: InlineKeyboard): Promise<boolean> {
    if (!(await this.canReplyTo(chatId))) return false;
    return (await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, MAX_TEXT_LENGTH),
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard },
    })) !== null;
  }

  /// Stops the button's loading spinner; `text` shows as a small toast.
  async answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    if (!this.isConfigured() || env.TELEGRAM_DRY_RUN) return;
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
  }

  /// Fills Telegram's "Menu" button next to the message box.
  /// No target = the default list; a chat id = that chat's own list (beats
  /// every other scope); 'all_private_chats' / 'all_group_chats' = those scopes.
  async setCommands(
    commands: ReadonlyArray<{ command: string; description: string }>,
    target?: string,
  ): Promise<boolean> {
    if (!this.isConfigured() || env.TELEGRAM_DRY_RUN) return false;
    return (await this.call('setMyCommands', { commands, ...commandScope(target) })) !== null;
  }

  /// Drops a chat's own list (e.g. after someone leaves).
  async clearCommands(chatId: string): Promise<boolean> {
    if (!this.isConfigured() || env.TELEGRAM_DRY_RUN) return false;
    return (await this.call('deleteMyCommands', commandScope(chatId))) !== null;
  }

  /// The bot's @username, needed to build the invite link.
  async getBotUsername(): Promise<string | null> {
    if (this.botUsername || !this.isConfigured()) return this.botUsername;
    const me = (await this.call('getMe', {})) as { username?: string } | null;
    this.botUsername = me?.username ?? null;
    return this.botUsername;
  }

  private async canReplyTo(chatId: string): Promise<boolean> {
    if (!this.isConfigured() || env.TELEGRAM_DRY_RUN) return false;
    try {
      return await this.recipients.isMember(chatId);
    } catch {
      return this.recipients.isAdmin(chatId);
    }
  }

  /// Single attempt; menus are interactive, so a retry storm helps nobody.
  private async call(method: string, body: Record<string, unknown> | FormData): Promise<unknown> {
    try {
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        ...(body instanceof FormData ? {} : { headers: { 'Content-Type': 'application/json' } }),
        signal: AbortSignal.timeout(env.REQUEST_TIMEOUT_MS),
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; result?: unknown; description?: string }
        | null;
      if (response.ok && payload?.ok) return payload.result ?? true;
      // Re-rendering an unchanged menu is not a failure.
      if (payload?.description?.includes('message is not modified')) return true;
      logger.warn(`Telegram ${method} failed`, `status=${response.status} ${payload?.description ?? ''}`.trim());
      return null;
    } catch {
      // Never log the error itself: its URL contains the bot token.
      logger.warn(`Telegram ${method} failed (network)`);
      return null;
    }
  }

  async reply(chatId: string, text: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    if (env.TELEGRAM_DRY_RUN) return true;
    if (!(await this.canReplyTo(chatId))) return false;
    return (await this.sendTo(chatId, text)).success;
  }

  private async sendTo(
    chatId: string,
    text: string,
    retryKey?: string,
  ): Promise<{ success: boolean; messageId: string | null; error?: string; status?: number }> {
    const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
      return await withRetry(
        async () => {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(env.REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              chat_id: chatId,
              // Plain text unless the alert carries SKU links (then escaped HTML):
              // Markdown would mangle Thai names and '/' in part numbers.
              ...toTelegramBody(text),
              disable_web_page_preview: true,
            }),
          });

          if (!response.ok) {
            const body = await response.text();
            throw new TelegramApiError(
              `Telegram send failed status=${response.status} body=${body.slice(0, 300)}`,
              response.status,
            );
          }

          const payload = (await response.json()) as { result?: { message_id?: number } };
          const messageId = payload.result?.message_id?.toString() ?? null;
          logger.info(
            'Telegram notification sent',
            `chat=${maskChatId(chatId)} messageId=${messageId}${retryKey ? ` key=${retryKey.slice(0, 8)}` : ''}`,
          );
          return { success: true, messageId };
        },
        {
          retries: env.MAX_RETRIES,
          baseDelayMs: env.RETRY_BASE_DELAY_MS,
          label: `Telegram send to ${maskChatId(chatId)}`,
          // 4xx other than 429 means a bad token or chat id - retrying cannot help.
          isRetryable: (error) =>
            !(error instanceof TelegramApiError) ||
            error.status >= 500 ||
            error.status === 429,
        },
      );
    } catch (error) {
      return {
        success: false,
        messageId: null,
        error: error instanceof Error ? error.message : String(error),
        status: error instanceof TelegramApiError ? error.status : undefined,
      };
    }
  }
}

const commandScope = (target?: string): Record<string, unknown> => {
  if (!target) return {};
  if (target === 'all_private_chats' || target === 'all_group_chats') return { scope: { type: target } };
  return { scope: { type: 'chat', chat_id: target } };
};

const maskChatId = (chatId: string): string =>
  chatId.length <= 5 ? chatId : `${chatId.slice(0, 3)}...${chatId.slice(-2)}`;

export const telegramNotificationService = new TelegramNotificationService();
