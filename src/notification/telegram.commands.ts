import { randomUUID } from 'node:crypto';
import { membershipSettings, type MembershipSettingsStore, parseMembershipPrice, formatMembershipPrice } from './membership.settings.js';
import { env, isTelegramConfigured, monitoredModelsLabel } from '../config/env.js';
import { stockScheduler } from '../scheduler/stock.scheduler.js';
import {
  restockHistoryRepository,
  type RestockHistoryRepository,
  type SkuOption,
} from '../stock/restock.history.js';
import { currentStockRepository, type CurrentStockRepository } from '../stock/stock.current.js';
import { modelPauseStore, type ModelPauseStore } from '../stock/model.pause.js';
import { addDays, dateKey, formatDateKey, parseDateInput } from '../utils/datetime.js';
import { logger } from '../utils/logger.js';
import { isMuted, scopedValue, variantValue, type Mutes } from './alert.filter.js';
import { buildStatusMessage, readStatus } from './status.report.js';
import {
  directMessageMembers,
  directMessageText,
  alertsHome,
  alertsModel,
  expiryPicker,
  expiryPrompt,
  historyHome,
  historyModel,
  historyView,
  modelsOf,
  variantsOf,
  inviteLink,
  inviteMessages,
  mainMenu,
  membersMenu,
  modelChecksMenu,
  NEWS_MAX_LENGTH,
  newsMessage,
  newsPreview,
  newsPrompt,
  newsResult,
  statusMenu,
  stockAll,
  stockPicker,
  stockView,
  subscriberName,
  type Menu,
} from './telegram.menus.js';
import { telegramAlertPreferences, type TelegramAlertPreferences } from './telegram.preferences.js';
import {
  inviteCodeMatches,
  telegramRecipients,
  type TelegramRecipients,
} from './telegram.recipients.js';
import { telegramNotificationService } from './telegram.service.js';

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    message_id?: number;
    photo?: Array<{ file_id: string }>;
    document?: { file_id: string; mime_type?: string };
    chat: { id: number; type?: string; title?: string; first_name?: string; last_name?: string; username?: string };
    from?: { first_name?: string; last_name?: string; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

const STATUS_RE = /^(?:\/status|status|สถานะ|เช็คสถานะ|เช็กสถานะ|สถานะการเช็ค)$/;
const PAUSE_RE = /^\/(?:pause|stop)$/;
const RESUME_RE = /^\/resume$/;
const MENU_RE = /^(?:\/(?:menu|help)|menu|เมนู)$/;
const ALERTS_RE = /^(?:\/(?:alerts|notify)|แจ้งเตือน|ตั้งค่าแจ้งเตือน)$/;
const HISTORY_RE = /^(?:\/history|สถิติ|ดูสถิติ|ประวัติ|ประวัติเติมของ)$/;
const STOCK_RE = /^(?:\/stock|สต็อก|สต๊อก|เช็คของ|เช็กของ)$/;
const NEWS_RE = /^\/(?:news|announce|broadcast)$/;
/// Telegram allows ~30 messages a second per bot; stay well under it.
const NEWS_SEND_GAP_MS = 60;

/// Shown in Telegram's "Menu" button next to the message box.
export const MEMBER_COMMANDS = [
  { command: 'menu', description: '🏠 เมนูหลัก' },
  { command: 'stock', description: '📦 ดูของที่มีตอนนี้' },
  { command: 'alerts', description: '🔔 เลือกรุ่น สี ความจุ ที่อยากให้เตือน' },
  { command: 'history', description: '📈 ดูสถิติของเคยเข้า' },
  { command: 'leave', description: '👋 เลิกรับการแจ้งเตือน' },
] as const;

export const ADMIN_COMMANDS = [
  ...MEMBER_COMMANDS.filter((item) => item.command !== 'leave'),
  { command: 'status', description: '📊 สถานะบอท' },
  { command: 'models', description: '⏯️ หยุด/เริ่มเช็คแต่ละรุ่น' },
  { command: 'invite', description: '🔗 ส่งคำเชิญ' },
  { command: 'members', description: '👥 ดูสมาชิก' },
  { command: 'news', description: '📣 ส่งข้อความถึงสมาชิก' },
  { command: 'pause', description: '⏸️ หยุดเช็คของชั่วคราว (มีผลกับทุกคน)' },
  { command: 'resume', description: '▶️ เริ่มเช็คของต่อ' },
] as const;

const BACK_TO_MAIN = { text: '🏠 เมนูหลัก', callback_data: 'm' };

const WAITING_TEXT = '⏳ ส่งคำขอเข้าร่วมเรียบร้อยแล้ว\n\n💳 ดำเนินการชำระเงิน แล้วส่งรูปสลิปในแชตนี้\nรอเจ้าของบอทตรวจสอบและอนุมัติการเข้าร่วม\n\n🔔 เมื่อได้รับอนุมัติ บอทจะแจ้งที่นี่ทันที';

/// Reverse of modelRef(): a button's model -> its index in what this chat
/// sees. -1 when the model is not (or no longer) visible to this chat.
const modelIndexFrom = (ref: string | undefined, models: readonly string[]): number =>
  ref?.startsWith('#') ? Number.parseInt(ref.slice(1), 10) : models.indexOf(ref ?? '');

export class TelegramCommandService {
  private controller: AbortController | null = null;
  private task: Promise<void> | null = null;
  private offset = 0;
  /// Admin chat -> member whose expiry date the admin is about to type.
  private readonly awaitingExpiry = new Map<string, { target: string; messageId: number }>();
  /// Admin chat -> news being written: no text yet = waiting for it.
  private readonly directDrafts = new Map<string, { target: string; text?: string; token: string }>();
  private readonly awaitingPrice = new Set<string>();
  private readonly newsDrafts = new Map<string, { text?: string }>();

  constructor(
    private readonly preferences: TelegramAlertPreferences = telegramAlertPreferences,
    private readonly history: RestockHistoryRepository = restockHistoryRepository,
    private readonly recipients: TelegramRecipients = telegramRecipients,
    private readonly currentStock: CurrentStockRepository = currentStockRepository,
    private readonly pauses: ModelPauseStore = modelPauseStore,
    private readonly membership: MembershipSettingsStore = membershipSettings,
  ) {}

  start(): void {
    if (this.task || !isTelegramConfigured() || env.TELEGRAM_DRY_RUN) return;
    this.controller = new AbortController();
    this.task = this.poll(this.controller.signal);
    void Promise.resolve()
      .then(() => this.registerCommandMenus())
      .catch(() => logger.warn('Could not register Telegram command menu'));
    logger.info('Telegram status commands enabled');
  }

  /// Telegram picks the most specific list it has: a chat's own list, then
  /// "all private / group chats", then the default. A list left over in a
  /// broader scope (e.g. set from BotFather) would hide the default from
  /// members, so the member list is written to every scope AND to each
  /// member's own chat; owners get theirs per chat.
  async registerCommandMenus(): Promise<void> {
    await telegramNotificationService.setCommands(MEMBER_COMMANDS);
    await telegramNotificationService.setCommands(MEMBER_COMMANDS, 'all_private_chats');
    await telegramNotificationService.setCommands(MEMBER_COMMANDS, 'all_group_chats');
    for (const chatId of env.telegramChatIds) {
      await telegramNotificationService.setCommands(ADMIN_COMMANDS, chatId);
    }
    for (const subscriber of await this.recipients.subscribers().catch(() => [])) {
      if (!this.recipients.isAdmin(subscriber.chatId)) {
        await telegramNotificationService.setCommands(MEMBER_COMMANDS, subscriber.chatId);
      }
    }
    logger.info('Telegram command menus registered');
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    await this.task;
    this.task = null;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }

    const message = update.message;
    if (!message) return;
    const chatId = String(message.chat.id);
    const receipt = message.photo?.length || message.document?.mime_type?.startsWith('image/')
      || message.document?.mime_type === 'application/pdf';
    if (receipt && message.message_id !== undefined && !this.recipients.isAdmin(chatId)) {
      await this.handleReceipt(chatId, message.message_id);
      return;
    }
    if (!message.text) return;
    const [head = '', ...args] = message.text.trim().split(/\s+/);
    // "/status@my_bot" -> "/status"; only slash commands carry a bot suffix.
    const lowered = head.toLowerCase();
    const command = lowered.startsWith('/') ? lowered.replace(/@[a-z0-9_]+$/, '') : message.text.trim().toLowerCase();
    const admin = this.recipients.isAdmin(chatId);

    if (command === '/start') {
      await this.handleStart(chatId, message, args[0]);
      return;
    }

    let member = admin;
    if (!member) {
      try {
        member = await this.recipients.isMember(chatId);
      } catch {
        logger.error('Telegram subscriber lookup failed');
        return;
      }
    }
    if (!member) return;

    if (admin && this.directDrafts.has(chatId)) {
      if (command.startsWith('/')) {
        this.directDrafts.delete(chatId);
      } else {
        const draft = this.directDrafts.get(chatId)!;
        const text = message.text.trim();
        // Invalidate every earlier preview, including after an invalid edit.
        draft.text = undefined;
        draft.token = randomUUID();
        if (!text || text.length > NEWS_MAX_LENGTH) {
          await telegramNotificationService.reply(chatId, `⚠️ กรุณาพิมพ์ข้อความ 1–${NEWS_MAX_LENGTH} ตัวอักษร`);
          return;
        }
        const person = await this.recipients.find(draft.target);
        if (!person || person.approved === false) {
          this.directDrafts.delete(chatId);
          await telegramNotificationService.reply(chatId, '⚠️ ผู้รับไม่ได้เป็นสมาชิกแล้ว กรุณาเลือกใหม่จาก /menu');
          return;
        }
        draft.text = text;
        await this.sendMenu(chatId, {
          text: `👀 ตัวอย่างข้อความถึง ${subscriberName(person).slice(0, 80)}\n──────────\n${directMessageText(text)}\n──────────\nพิมพ์ข้อความใหม่เพื่อแก้ไข หรือกดยืนยันส่ง`,
          keyboard: [[{ text: '✅ ยืนยันส่งรายคน', callback_data: `dms:${draft.token}` }], [{ text: '❌ ยกเลิก', callback_data: 'dmx' }]],
        });
        return;
      }
    }

    if (admin && this.awaitingPrice.has(chatId)) {
      if (command.startsWith('/')) {
        this.awaitingPrice.delete(chatId);
      } else {
        const price = parseMembershipPrice(message.text);
        if (price === null) {
          await telegramNotificationService.reply(chatId, '⚠️ กรุณาพิมพ์ราคา 0–999999.99 บาท เช่น 199 หรือ 199.50 (ไม่ต้องใส่เครื่องหมายคั่นหลักพัน)');
          return;
        }
        try {
          await this.membership.setPrice(price);
          this.awaitingPrice.delete(chatId);
          await this.sendMenu(chatId, {
            text: `✅ บันทึกค่าสมาชิก ${formatMembershipPrice(price)} แล้ว\nผู้ขอเข้าร่วมจะเห็นยอดนี้เมื่อกด Start ครั้งถัดไป`,
            keyboard: [[{ text: '💳 แก้ไขราคา', callback_data: 'fee' }], [BACK_TO_MAIN]],
          });
        } catch {
          await telegramNotificationService.reply(chatId, '😵 บันทึกราคาไม่สำเร็จ กรุณาลองพิมพ์ราคาอีกครั้ง');
        }
        return;
      }
    }

    // The admin tapped ✏️ and is now typing a member's expiry date. Any slash
    // command cancels the wait and runs as usual.
    const waiting = admin ? this.awaitingExpiry.get(chatId) : undefined;
    if (waiting) {
      if (!command.startsWith('/')) {
        await this.handleTypedExpiry(chatId, waiting, message.text);
        return;
      }
      this.awaitingExpiry.delete(chatId);
    }
    // Same for news: any plain text becomes (or replaces) the draft.
    if (admin && this.newsDrafts.has(chatId)) {
      if (!command.startsWith('/')) {
        await this.draftNews(chatId, message.text.trim());
        return;
      }
      this.newsDrafts.delete(chatId);
    }

    if (MENU_RE.test(command)) {
      await this.sendMenu(chatId, mainMenu(monitoredModelsLabel(), admin));
      return;
    }
    if (ALERTS_RE.test(command)) {
      await this.sendMenu(chatId, () => this.alertsHomeMenu(chatId));
      return;
    }
    if (STOCK_RE.test(command)) {
      await this.sendMenu(chatId, () => this.stockMenu(chatId, null));
      return;
    }
    if (HISTORY_RE.test(command)) {
      await this.sendMenu(chatId, () => this.historyHomeMenu(chatId));
      return;
    }
    if (command === '/leave' || command === '/unsubscribe') {
      await this.leave(chatId, admin);
      return;
    }
    // Status is admin-only; members are pointed at their own menu instead.
    if (STATUS_RE.test(command) && admin) {
      await telegramNotificationService.reply(chatId, await this.statusText(admin));
      return;
    }

    const adminOnly = STATUS_RE.test(command) || PAUSE_RE.test(command) || RESUME_RE.test(command)
      || command === '/members' || command === '/models' || command === '/invite' || NEWS_RE.test(command);
    if (!adminOnly) return;
    if (!admin) {
      await telegramNotificationService.reply(chatId, '🔒 คำสั่งนี้ใช้ได้เฉพาะเจ้าของบอท');
      return;
    }
    if (command === '/members') {
      await this.sendMenu(chatId, () => this.membersMenu());
      return;
    }
    if (command === '/invite') {
      await this.sendInvite(chatId);
      return;
    }
    if (command === '/models') {
      await this.sendMenu(chatId, () => this.modelChecks());
      return;
    }
    if (NEWS_RE.test(command)) {
      // "/news <text>" skips the prompt and goes straight to the preview.
      const inline = message.text.trim().slice(head.length).trim();
      this.awaitingExpiry.delete(chatId);
      if (inline) {
        await this.draftNews(chatId, inline);
      } else {
        this.newsDrafts.set(chatId, {});
        await this.sendMenu(chatId, async () => newsPrompt(await this.memberCount()));
      }
      return;
    }

    const pause = PAUSE_RE.test(command);
    try {
      if (pause) {
        await stockScheduler.stop();
      } else {
        await stockScheduler.start();
      }
      await telegramNotificationService.reply(chatId,
        `${this.schedulerText()}\n${pause
          ? '⏸️ หยุดเช็คของแล้ว (รอบที่กำลังเช็คอยู่จะทำจนจบ)\n▶️ พิมพ์ /resume เพื่อเริ่มต่อ'
          : '▶️ เริ่มเช็คของต่อแล้ว\n⏸️ พิมพ์ /pause เพื่อหยุด'}`);
    } catch {
      logger.error('Telegram scheduler command failed');
      await telegramNotificationService.reply(chatId, '😵 ทำไม่สำเร็จ ลองใหม่อีกครั้งนะ');
    }
  }

  // -- Joining / leaving --------------------------------------------------------

  /// "/start" alone is what Telegram sends when someone taps Start; the
  /// invite link t.me/<bot>?start=<code> sends "/start <code>".
  private async handleStart(
    chatId: string,
    message: NonNullable<TelegramUpdate['message']>,
    code: string | undefined,
  ): Promise<void> {
    const admin = this.recipients.isAdmin(chatId);
    let member = admin;
    try {
      member = member || (await this.recipients.isMember(chatId));
    } catch {
      logger.error('Telegram subscriber lookup failed');
      await telegramNotificationService.sendUnchecked(chatId, '😵 ระบบมีปัญหาชั่วคราว ลองใหม่อีกครั้งนะ');
      return;
    }

    if (member) {
      const menu = mainMenu(monitoredModelsLabel(), admin);
      await telegramNotificationService.sendMenu(chatId, `✅ คุณรับการแจ้งเตือนอยู่แล้ว\n\n${menu.text}`, menu.keyboard);
      return;
    }

    let pending = false;
    try {
      pending = await this.recipients.isPending(chatId);
    } catch {
      pending = false;
    }
    if (pending) {
      await this.sendPaymentInstructions(chatId);
      return;
    }

    if (!inviteCodeMatches(code)) {
      await telegramNotificationService.sendUnchecked(chatId,
        '🔒 บอทนี้ใช้ได้เฉพาะคนที่ได้รับลิงก์เชิญ\n🙏 ขอลิงก์จากเจ้าของบอท แล้วกดลิงก์นั้นอีกครั้งนะ');
      return;
    }

    const name = message.chat.title
      ?? ([message.from?.first_name ?? message.chat.first_name, message.from?.last_name ?? message.chat.last_name]
        .filter(Boolean).join(' ') || null);
    const username = message.chat.title ? null : (message.from?.username ?? message.chat.username ?? null);
    try {
      await this.recipients.request({ chatId, name, username });
    } catch {
      logger.error('Could not save Telegram join request');
      await telegramNotificationService.sendUnchecked(chatId, '😵 ส่งคำขอไม่สำเร็จ ลองกดลิงก์อีกครั้งนะ');
      return;
    }
    logger.info(`Telegram join request via invite link chat=${chatId}`);
    await this.sendPaymentInstructions(chatId);

    const who = subscriberName({ chatId, name, username });
    for (const adminChat of env.telegramChatIds) {
      await telegramNotificationService.sendMenu(adminChat,
        [`🙋 มีคนขอเข้าร่วม`, `👤 ${who}${message.chat.title ? ' (กลุ่ม)' : ''}`, '', '👇 อนุมัติให้รับแจ้งเตือนไหม'].join('\n'),
        [[
          { text: '✅ อนุมัติ', callback_data: `ja:${chatId}` },
          { text: '❌ ปฏิเสธ', callback_data: `jr:${chatId}` },
        ]]);
    }
  }

  private async sendPaymentInstructions(chatId: string): Promise<void> {
    let price: number | null;
    try {
      price = await this.membership.price();
    } catch {
      await telegramNotificationService.sendUnchecked(chatId, '😵 อ่านยอดค่าสมาชิกไม่ได้ กรุณาติดต่อเจ้าของบอทก่อนชำระเงิน');
      return;
    }
    const amount = price === null ? '💰 ยอดชำระ: กรุณาสอบถามเจ้าของบอท' : `💰 ค่าสมาชิก / ยอดชำระ: ${formatMembershipPrice(price)}`;
    const text = WAITING_TEXT.replace('💳 ดำเนินการชำระเงิน', `${amount}\n\n💳 ดำเนินการชำระเงิน`);
    if (env.TELEGRAM_PAYMENT_QR_PATH && await telegramNotificationService.sendPaymentQr(chatId, text)) return;
    await telegramNotificationService.sendUnchecked(chatId, text);
  }

  private async handleReceipt(chatId: string, messageId: number): Promise<void> {
    try {
      const person = await this.recipients.find(chatId);
      if (!person) {
        await telegramNotificationService.sendUnchecked(chatId, '🔒 กรุณากดลิงก์เชิญและส่งคำขอเข้าร่วมก่อนส่งสลิปนะครับ');
        return;
      }
      let delivered = false;
      for (const adminChat of env.telegramChatIds) {
        const copied = await telegramNotificationService.copyReceipt(adminChat, chatId, messageId);
        if (!copied) continue;
        const notified = await telegramNotificationService.sendMenu(adminChat,
          ['🧾 ได้รับสลิปชำระเงิน', `👤 ${subscriberName(person)}`, `🆔 ${chatId}`, '',
            person.approved === false ? '👇 ตรวจสอบยอดชำระก่อนอนุมัติ' : `🔄 สลิปต่ออายุสมาชิก${person.expiresOn ? ` · หมดอายุ ${formatDateKey(dateKey(person.expiresOn))}` : ''}\n👇 ตรวจสอบยอด แล้วกดกำหนดวันหมดอายุใหม่`].join('\n'),
          person.approved === false ? [[
            { text: '✅ อนุมัติ', callback_data: `ja:${chatId}` },
            { text: '❌ ปฏิเสธ', callback_data: `jr:${chatId}` },
          ]] : [[{ text: '📅 ตรวจสลิป / ต่ออายุสมาชิก', callback_data: `ex:${chatId}` }]]);
        delivered = notified || delivered;
      }
      await telegramNotificationService.sendUnchecked(chatId, delivered
        ? `🧾 ส่งสลิปให้เจ้าของบอทแล้ว\n⏳ รอตรวจสอบการชำระเงินนะครับ\n🔔 ${person.approved === false ? 'บอทจะแจ้งที่นี่เมื่อได้รับอนุมัติ' : 'บอทจะแจ้งเมื่อเจ้าของบอทอัปเดตวันหมดอายุแล้ว'}`
        : '😵 ส่งสลิปให้เจ้าของบอทไม่สำเร็จ กรุณาลองส่งอีกครั้งนะครับ');
    } catch {
      logger.error('Could not relay Telegram payment receipt');
      await telegramNotificationService.sendUnchecked(chatId, '😵 ระบบมีปัญหาชั่วคราว กรุณาลองส่งสลิปอีกครั้งนะครับ');
    }
  }

  // -- Public member actions (used by the web admin UI) ----------------------
  // Same side effects as the Telegram buttons: the member is told what happened.

  approveMember(target: string): Promise<{ ok: boolean; text: string }> {
    return this.approveRequest(target);
  }

  rejectMember(target: string): Promise<string> {
    return this.rejectRequest(target);
  }

  setMemberExpiry(target: string, key: string | null): Promise<string> {
    return this.setExpiry(target, key);
  }

  async removeMember(target: string): Promise<boolean> {
    const removed = await this.recipients.remove(target);
    await this.forgetFilters(target);
    await telegramNotificationService.clearCommands(target).catch(() => false);
    if (removed) {
      logger.info(`Telegram member removed from admin UI chat=${target}`);
      await telegramNotificationService.sendUnchecked(target, '👋 คุณถูกนำออกจากรายชื่อรับการแจ้งเตือนแล้ว').catch(() => false);
    }
    return removed;
  }

  /// Admin said yes: make them a member and welcome them.
  private async approveRequest(target: string): Promise<{ ok: boolean; text: string }> {
    const person = await this.recipients.find(target);
    if (!(await this.recipients.approve(target))) return { ok: false, text: 'คำขอนี้จัดการไปแล้ว' };
    logger.info(`Telegram join request approved chat=${target}`);
    await telegramNotificationService.setCommands(MEMBER_COMMANDS, target).catch(() => false);
    const menu = mainMenu(monitoredModelsLabel());
    await telegramNotificationService.sendMenu(target, [
      '🎉 ได้รับอนุมัติแล้ว ยินดีต้อนรับ!',
      'ต่อไปถ้ามีของเข้า บอทจะเตือนทันที 🔔',
      '',
      '✅ ตอนนี้เตือนทุกสี ทุกความจุ',
      '',
      '👉 อยากได้เฉพาะบางสี/ความจุ กด 🔔 ตั้งค่าการแจ้งเตือน',
      '👉 ดูของที่มีตอนนี้ พิมพ์ /stock',
      '👋 เลิกรับการแจ้งเตือน พิมพ์ /leave',
    ].join('\n'), menu.keyboard);
    return { ok: true, text: `✅ อนุมัติ ${person ? subscriberName(person) : target} แล้ว` };
  }

  // -- Member expiry ----------------------------------------------------------

  /// Sets (key) or clears (null) a member's expiry; returns the admin's toast.
  private async setExpiry(target: string, key: string | null): Promise<string> {
    const person = await this.recipients.find(target);
    if (!person || person.approved === false || !(await this.recipients.setExpiry(target, key))) {
      return 'คนนี้ไม่ได้เป็นสมาชิกแล้ว';
    }
    const who = subscriberName(person);
    logger.info(`Telegram member expiry chat=${target} expiresOn=${key ?? 'never'}`);
    if (key) {
      await telegramNotificationService.sendUnchecked(target,
        `📅 สิทธิ์รับการแจ้งเตือนของคุณใช้ได้ถึงวันที่ ${formatDateKey(key)}`).catch(() => false);
      return `📅 ${who} หมดอายุ ${formatDateKey(key)}`;
    }
    if (person.expiresOn) {
      await telegramNotificationService.sendUnchecked(target, '♾️ สิทธิ์รับการแจ้งเตือนของคุณไม่มีวันหมดอายุแล้ว').catch(() => false);
    }
    return `♾️ ${who} ไม่มีวันหมดอายุ`;
  }

  private async handleTypedExpiry(
    chatId: string,
    waiting: { target: string; messageId: number },
    input: string,
  ): Promise<void> {
    const today = dateKey();
    const key = parseDateInput(input, today);
    if (!key) {
      await telegramNotificationService.reply(chatId, '🤔 อ่านวันที่ไม่ออก ลองพิมพ์แบบ 31/12/2026 หรือจำนวนวัน เช่น 30\n↩️ หรือพิมพ์ /members เพื่อยกเลิก');
      return;
    }
    if (key < today) {
      await telegramNotificationService.reply(chatId, `⚠️ ${formatDateKey(key)} ผ่านมาแล้ว ใส่วันที่ตั้งแต่วันนี้เป็นต้นไปนะ`);
      return;
    }
    this.awaitingExpiry.delete(chatId);
    const result = await this.setExpiry(waiting.target, key);
    await telegramNotificationService.editMenu(chatId, waiting.messageId, result, [[{ text: '👥 ดูสมาชิก', callback_data: 'sl' }]]);
    await telegramNotificationService.reply(chatId, `✅ ${result}`);
  }

  /// Admin said no: drop the request and tell them politely.
  private async rejectRequest(target: string): Promise<string> {
    const person = await this.recipients.find(target);
    if (!person || person.approved !== false) return 'คำขอนี้จัดการไปแล้ว';
    await this.recipients.remove(target);
    logger.info(`Telegram join request rejected chat=${target}`);
    await telegramNotificationService.sendUnchecked(target, '🙏 คำขอเข้าร่วมไม่ได้รับอนุมัติ');
    return `❌ ปฏิเสธ ${subscriberName(person)} แล้ว`;
  }

  private async leave(chatId: string, admin: boolean): Promise<void> {
    if (admin) {
      await telegramNotificationService.reply(chatId, '👑 แชทนี้เป็นเจ้าของบอท เลิกรับจากตรงนี้ไม่ได้\n⚙️ ถ้าจะเลิก ให้ลบออกจาก TELEGRAM_CHAT_ID ในไฟล์ .env');
      return;
    }
    try {
      await this.recipients.remove(chatId);
      await this.forgetFilters(chatId);
      await telegramNotificationService.clearCommands(chatId).catch(() => false);
      await telegramNotificationService.sendUnchecked(chatId, '👋 เลิกรับการแจ้งเตือนแล้ว\nอยากกลับมา กดลิงก์เชิญได้ทุกเมื่อนะ');
    } catch {
      logger.error('Telegram leave failed');
      await telegramNotificationService.reply(chatId, '😵 ทำไม่สำเร็จ ลองใหม่อีกครั้งนะ');
    }
  }

  /// Best effort: stale filters only matter if the same chat rejoins.
  private async forgetFilters(chatId: string): Promise<void> {
    await this.preferences.unmuteAll(chatId).catch(() => logger.warn('Could not clear alert filters of a removed chat'));
  }

  private async modelChecks(): Promise<Menu> {
    const [skus, paused] = await Promise.all([this.history.listSkus(), this.pauses.list()]);
    return modelChecksMenu(modelsOf(skus), paused);
  }

  private async membersMenu(): Promise<Menu> {
    const [subscribers, pending] = await Promise.all([this.recipients.subscribers(), this.recipients.pending()]);
    return membersMenu(subscribers, env.telegramChatIds.length, pending);
  }

  /// Sent as NEW messages (not an edit) so the owner can forward them.
  private async sendInvite(chatId: string): Promise<void> {
    try {
      const link = inviteLink(await telegramNotificationService.getBotUsername(), env.TELEGRAM_INVITE_CODE);
      for (const text of inviteMessages(link, env.TELEGRAM_INVITE_CODE.length > 0)) {
        await telegramNotificationService.reply(chatId, text);
      }
    } catch {
      logger.error('Telegram invite failed');
      await telegramNotificationService.reply(chatId, '😵 ส่งคำเชิญไม่สำเร็จ ลองใหม่อีกครั้งนะ');
    }
  }

  // -- News to members ---------------------------------------------------------

  private async memberCount(): Promise<number> {
    return (await this.recipients.subscribers()).length;
  }

  /// Saves the text and shows the owner a preview with ✅ / ❌.
  private async draftNews(chatId: string, text: string): Promise<void> {
    if (text.length > NEWS_MAX_LENGTH) {
      this.newsDrafts.set(chatId, {});
      await telegramNotificationService.reply(chatId,
        `✂️ ข้อความยาวเกินไป (${text.length} ตัวอักษร) ส่งได้ไม่เกิน ${NEWS_MAX_LENGTH} ตัวอักษร ลองย่อแล้วพิมพ์มาใหม่นะ`);
      return;
    }
    this.newsDrafts.set(chatId, { text });
    await this.sendMenu(chatId, async () => newsPreview(text, await this.memberCount()));
  }

  /// One member at a time with a short gap, so Telegram never rate-limits us.
  /// Owners are not included: they already saw the preview.
  private async broadcastNews(text: string): Promise<{ sent: number; failed: string[] }> {
    const body = newsMessage(text);
    const failed: string[] = [];
    let sent = 0;
    for (const [index, subscriber] of (await this.recipients.subscribers()).entries()) {
      if (this.recipients.isAdmin(subscriber.chatId)) continue;
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, NEWS_SEND_GAP_MS));
      const ok = await telegramNotificationService.sendUnchecked(subscriber.chatId, body).catch(() => false);
      if (ok) sent += 1;
      else failed.push(subscriberName(subscriber));
    }
    logger.info(`Telegram news sent to ${sent} member(s)${failed.length ? `, ${failed.length} failed` : ''}`);
    return { sent, failed };
  }

  // -- Inline keyboard callbacks --------------------------------------------

  private async handleCallback(query: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
    const chatId = query.message ? String(query.message.chat.id) : '';
    const admin = this.recipients.isAdmin(chatId);
    const member = admin || (query.message ? await this.recipients.isMember(chatId).catch(() => false) : false);
    if (!query.message || !member) {
      await telegramNotificationService.answerCallback(query.id, '🔒 ใช้เมนูนี้ไม่ได้');
      return;
    }
    const messageId = query.message.message_id;
    const [action = '', code, ...rest] = (query.data ?? '').split(':');
    if (action !== 'fee') this.awaitingPrice.delete(chatId);
    if (!['dm', 'dms', 'dmx'].includes(action)) this.directDrafts.delete(chatId);

    let toast: string | undefined;
    try {
      let menu: Menu;
      switch (action) {
        case 'x':
          // Section label inside a keyboard - nothing to do.
          await telegramNotificationService.answerCallback(query.id);
          return;
        case 'm':
          this.awaitingPrice.delete(chatId);
          menu = mainMenu(monitoredModelsLabel(), admin);
          break;
        case 'st':
          if (!admin) {
            await telegramNotificationService.answerCallback(query.id, '🔒 สำหรับเจ้าของบอทเท่านั้น');
            return;
          }
          menu = statusMenu(await this.statusText(admin));
          break;
        case 'mo':
        case 'mp': {
          if (!admin) {
            await telegramNotificationService.answerCallback(query.id, '🔒 สำหรับเจ้าของบอทเท่านั้น');
            return;
          }
          if (action === 'mp') {
            const model = modelsOf(await this.history.listSkus())[Number.parseInt(code ?? '', 10)];
            if (model) {
              const paused = await this.pauses.toggle(model);
              toast = paused ? `⏸️ หยุดเช็ค ${model} แล้ว` : `▶️ เริ่มเช็ค ${model} แล้ว`;
              logger.info(`Model ${paused ? 'paused' : 'resumed'} from Telegram: ${model}`);
            }
          }
          menu = await this.modelChecks();
          break;
        }
        case 'ja':
        case 'jr': {
          if (!admin) {
            await telegramNotificationService.answerCallback(query.id, '🔒 สำหรับเจ้าของบอทเท่านั้น');
            return;
          }
          const target = [code, ...rest].join(':');
          const result = action === 'ja'
            ? await this.approveRequest(target)
            : { ok: false, text: await this.rejectRequest(target) };
          await telegramNotificationService.answerCallback(query.id, result.text);
          // Replace the request message with the outcome, so it cannot be tapped
          // twice; after an approval, ask straight away when the member expires.
          const person = result.ok ? await this.recipients.find(target) : undefined;
          if (person) {
            const picker = expiryPicker(person, env.MEMBER_EXPIRY_CHECK_HOUR, result.text);
            await telegramNotificationService.editMenu(chatId, messageId, picker.text, picker.keyboard);
          } else {
            await telegramNotificationService.editMenu(chatId, messageId, result.text, [
              [{ text: '👥 ดูสมาชิก', callback_data: 'sl' }],
            ]);
          }
          return;
        }
        case 'ex':
        case 'es':
        case 'ec':
        case 'ecx': {
          if (!admin) {
            await telegramNotificationService.answerCallback(query.id, '🔒 สำหรับเจ้าของบอทเท่านั้น');
            return;
          }
          if (action === 'ecx') {
            this.awaitingExpiry.delete(chatId);
            menu = await this.membersMenu();
            toast = 'ยกเลิกแล้ว';
            break;
          }
          const target = (action === 'es' ? rest : [code, ...rest]).join(':');
          const person = await this.recipients.find(target);
          if (!person || person.approved === false) {
            toast = 'คนนี้ไม่ได้เป็นสมาชิกแล้ว';
            menu = await this.membersMenu();
            break;
          }
          if (action === 'ex') {
            menu = expiryPicker(person, env.MEMBER_EXPIRY_CHECK_HOUR);
            break;
          }
          if (action === 'ec') {
            this.awaitingExpiry.set(chatId, { target, messageId });
            menu = expiryPrompt(person);
            break;
          }
          const days = Number.parseInt(code ?? '', 10);
          if (!Number.isInteger(days) || days < 0) {
            await telegramNotificationService.answerCallback(query.id);
            return;
          }
          this.awaitingExpiry.delete(chatId);
          const result = await this.setExpiry(target, days === 0 ? null : addDays(dateKey(), days));
          await telegramNotificationService.answerCallback(query.id, result);
          await telegramNotificationService.editMenu(chatId, messageId, result, [
            [{ text: '👥 ดูสมาชิก', callback_data: 'sl' }],
          ]);
          return;
        }
        case 'dml':
        case 'dm':
        case 'dmx':
        case 'dms': {
          if (!admin) {
            await telegramNotificationService.answerCallback(query.id, '🔒 สำหรับเจ้าของบอทเท่านั้น');
            return;
          }
          this.awaitingExpiry.delete(chatId);
          this.awaitingPrice.delete(chatId);
          this.newsDrafts.delete(chatId);
          if (action === 'dml' || action === 'dmx') {
            this.directDrafts.delete(chatId);
            const page = Number(code ?? 0);
            menu = directMessageMembers((await this.recipients.subscribers()).filter((p) => !this.recipients.isAdmin(p.chatId)), Number.isSafeInteger(page) ? page : 0);
            break;
          }
          if (action === 'dm') {
            this.directDrafts.delete(chatId);
            const target = code ?? '';
            const person = await this.recipients.find(target);
            if (!person || person.approved === false || this.recipients.isAdmin(target)) {
              toast = 'ผู้รับไม่ได้เป็นสมาชิกแล้ว';
              menu = directMessageMembers((await this.recipients.subscribers()).filter((p) => !this.recipients.isAdmin(p.chatId)));
              break;
            }
            this.directDrafts.set(chatId, { target, token: randomUUID() });
            menu = {
              text: `💬 ส่งข้อความถึง ${subscriberName(person)}\n\n✏️ พิมพ์ข้อความที่ต้องการส่ง\nบอตจะแสดงตัวอย่างก่อน ยังไม่ส่งจนกดยืนยัน`,
              keyboard: [[{ text: '❌ ยกเลิก', callback_data: 'dmx' }]],
            };
            break;
          }
          const draft = this.directDrafts.get(chatId);
          if (!draft?.text || draft.token !== code) {
            await telegramNotificationService.answerCallback(query.id, 'ตัวอย่างนี้หมดอายุ ส่งแล้ว หรือยกเลิกแล้ว');
            return;
          }
          // Consume before any asynchronous work so repeated taps cannot resend.
          this.directDrafts.delete(chatId);
          const person = await this.recipients.find(draft.target);
          if (!person || person.approved === false || this.recipients.isAdmin(draft.target)) {
            toast = 'ผู้รับไม่ได้เป็นสมาชิกแล้ว';
            menu = { text: '⚠️ ไม่ได้ส่งข้อความ เพราะผู้รับไม่ได้เป็นสมาชิกแล้ว', keyboard: [[BACK_TO_MAIN]] };
            break;
          }
          await telegramNotificationService.answerCallback(query.id, '📤 กำลังส่ง...');
          const sent = await telegramNotificationService.sendUnchecked(draft.target, directMessageText(draft.text)).catch(() => false);
          await telegramNotificationService.editMenu(chatId, messageId,
            sent ? `✅ ส่งข้อความถึง ${subscriberName(person)} แล้ว` : `⚠️ ส่งข้อความถึง ${subscriberName(person)} ไม่สำเร็จ กรุณาตรวจสอบแล้วลองใหม่`,
            [[{ text: '💬 เลือกสมาชิก', callback_data: 'dml:0' }], [BACK_TO_MAIN]]);
          return;
        }
        case 'nw':
        case 'nws':
        case 'nwx': {
          if (!admin) {
            await telegramNotificationService.answerCallback(query.id, '🔒 สำหรับเจ้าของบอทเท่านั้น');
            return;
          }
          if (action === 'nw') {
            this.awaitingExpiry.delete(chatId);
            this.newsDrafts.set(chatId, {});
            menu = newsPrompt(await this.memberCount());
            break;
          }
          if (action === 'nwx') {
            this.newsDrafts.delete(chatId);
            toast = 'ยกเลิกแล้ว';
            menu = mainMenu(monitoredModelsLabel(), admin);
            break;
          }
          const draft = this.newsDrafts.get(chatId)?.text;
          if (!draft) {
            await telegramNotificationService.answerCallback(query.id, 'ข้อความนี้ส่งหรือยกเลิกไปแล้ว');
            await telegramNotificationService.editMenu(chatId, messageId, '📣 ข้อความนี้ส่งหรือยกเลิกไปแล้ว', [[BACK_TO_MAIN]]);
            return;
          }
          // Drop the draft first so a double tap cannot send it twice.
          this.newsDrafts.delete(chatId);
          await telegramNotificationService.answerCallback(query.id, '📤 กำลังส่ง...');
          const { sent, failed } = await this.broadcastNews(draft);
          await telegramNotificationService.editMenu(chatId, messageId,
            `${newsResult(sent, failed)}\n\n${newsMessage(draft)}`, [[BACK_TO_MAIN]]);
          return;
        }
        case 'fee': {
          if (!admin) {
            await telegramNotificationService.answerCallback(query.id, '🔒 สำหรับเจ้าของบอทเท่านั้น');
            return;
          }
          const price = await this.membership.price();
          this.awaitingExpiry.delete(chatId);
          this.newsDrafts.delete(chatId);
          this.awaitingPrice.add(chatId);
          menu = {
            text: `💳 ตั้งราคาค่าสมาชิก\n\nราคาปัจจุบัน: ${price === null ? 'ยังไม่ได้ตั้งราคา' : formatMembershipPrice(price)}\n\n✏️ พิมพ์ราคาใหม่เป็นบาท เช่น 199 หรือ 199.50\nราคาจะบันทึกไว้และแสดงให้ผู้ขอเข้าร่วมเมื่อกด Start\n\nยกเลิกด้วย /menu หรือกดเมนูหลัก`,
            keyboard: [[BACK_TO_MAIN]],
          };
          break;
        }
        case 'inv':
          if (!admin) {
            await telegramNotificationService.answerCallback(query.id, '🔒 สำหรับเจ้าของบอทเท่านั้น');
            return;
          }
          await telegramNotificationService.answerCallback(query.id, '🔗 ส่งคำเชิญให้แล้ว 👇');
          await this.sendInvite(chatId);
          return;
        case 'sl':
        case 'sx': {
          if (!admin) {
            await telegramNotificationService.answerCallback(query.id, '🔒 สำหรับเจ้าของบอทเท่านั้น');
            return;
          }
          const target = [code, ...rest].join(':');
          if (action === 'sx' && target) {
            const removed = await this.recipients.remove(target);
            await this.forgetFilters(target);
            await telegramNotificationService.clearCommands(target).catch(() => false);
            toast = removed ? '✅ นำออกแล้ว' : 'คนนี้ถูกนำออกไปแล้ว';
            if (removed) {
              await telegramNotificationService.sendUnchecked(target, '👋 คุณถูกนำออกจากรายชื่อรับการแจ้งเตือนแล้ว');
            }
          }
          menu = await this.membersMenu();
          break;
        }
        case 'a':
          menu = await this.alertsHomeMenu(chatId);
          break;
        case 'areset':
          await this.preferences.unmuteAll(chatId);
          toast = '🔔 เปิดเตือนทุกอย่างแล้ว';
          menu = await this.alertsHomeMenu(chatId);
          break;
        case 'am':
        case 'av':
        case 'avon':
        case 'avoff': {
          const modelIndex = modelIndexFrom(code, modelsOf(await this.visibleSkus(chatId)));
          toast = await this.applyAlertAction(chatId, action, modelIndex, Number.parseInt(rest[0] ?? '', 10));
          menu = await this.alertsModelMenu(chatId, modelIndex);
          break;
        }
        case 'amt':
        case 'at':
        case 'ati':
          // Buttons from the old color / size layout still sitting in a chat.
          toast = 'เมนูนี้เปลี่ยนแล้ว 👇 เลือกใหม่ได้เลย';
          menu = await this.alertsHomeMenu(chatId);
          break;
        case 's': {
          // The 📦 button asks which model first; one model -> straight to it.
          const models = modelsOf(await this.visibleSkus(chatId));
          menu = models.length === 1
            ? await this.stockMenu(chatId, 0)
            : stockPicker(models, await this.pauses.pausedModels());
          break;
        }
        case 'sa':
          menu = await this.stockMenu(chatId, null);
          break;
        case 'sm':
          menu = await this.stockMenu(chatId, modelIndexFrom(code, modelsOf(await this.visibleSkus(chatId))));
          break;
        case 'h':
          menu = await this.historyHomeMenu(chatId);
          break;
        case 'hm': {
          const [skus, counts] = await Promise.all([this.visibleSkus(chatId), this.history.restockCounts()]);
          menu = historyModel(skus, counts, this.history.retentionDays(), modelIndexFrom(code, modelsOf(skus)))
            ?? historyHome(skus, counts, this.history.retentionDays());
          break;
        }
        case 'hv': {
          const skus = await this.visibleSkus(chatId);
          const sku = skus.find((item) => item.variantId === code);
          if (!sku) {
            toast = 'ไม่พบรายการนี้แล้ว';
            menu = await this.historyHomeMenu(chatId);
            break;
          }
          menu = historyView(
            sku,
            await this.history.restocks(sku.variantId),
            this.history.retentionDays(),
            modelsOf(skus).indexOf(sku.model),
          );
          break;
        }
        default:
          await telegramNotificationService.answerCallback(query.id);
          return;
      }
      await telegramNotificationService.answerCallback(query.id, toast);
      await telegramNotificationService.editMenu(chatId, messageId, menu.text, menu.keyboard);
    } catch (error) {
      logger.error('Telegram menu action failed', error instanceof Error ? error.message : undefined);
      await telegramNotificationService.answerCallback(query.id, '😵 ทำไม่สำเร็จ ลองใหม่อีกครั้งนะ');
    }
  }

  /// Returns the toast text for the change, if any.
  private async applyAlertAction(
    chatId: string,
    action: string,
    modelIndex: number,
    variantIndex: number,
  ): Promise<string | undefined> {
    if (action === 'am') return undefined;
    const skus = await this.visibleSkus(chatId);
    const model = modelsOf(skus)[modelIndex];
    if (!model) return 'ตัวเลือกนี้เปลี่ยนไปแล้ว ลองเปิดเมนูใหม่นะ';
    const variants = variantsOf(skus, model);
    const values = variants.map((sku) => variantValue(sku.model, sku.color, sku.storage));
    await this.foldOldSettings(chatId, model, variants, await this.preferences.getMutes(chatId));

    if (action === 'avon') {
      await this.preferences.unmute(chatId, 'variant', values);
      return `✅ เปิดเตือนทุกแบบของ ${model} แล้ว`;
    }
    if (action === 'avoff') {
      await this.preferences.muteAll(chatId, 'variant', values);
      return `🔕 ปิดเตือนทุกแบบของ ${model} แล้ว`;
    }

    const sku = variants[variantIndex];
    if (!sku) return 'ตัวเลือกนี้เปลี่ยนไปแล้ว ลองเปิดเมนูใหม่นะ';
    const muted = await this.preferences.toggle(chatId, 'variant', variantValue(sku.model, sku.color, sku.storage));
    return muted ? `🔕 ไม่เตือน ${sku.colorTh} ${sku.storage} แล้ว` : `✅ เตือน ${sku.colorTh} ${sku.storage} แล้ว`;
  }

  /// Settings saved by the old layout (whole model, or a color / size of the
  /// model) are rewritten as the exact variants they covered, so from now on
  /// each button controls one variant and nothing else. Same result, new shape.
  private async foldOldSettings(chatId: string, model: string, variants: readonly SkuOption[], mutes: Mutes): Promise<void> {
    const scoped = [
      ...variants.map((sku) => scopedValue(model, sku.color)),
      ...variants.map((sku) => scopedValue(model, sku.storage)),
    ];
    const hasOld = mutes.model.has(model) || scoped.some((value) => mutes.color.has(value) || mutes.storage.has(value));
    if (!hasOld) return;
    const covered = variants.filter((sku) => isMuted(mutes, sku)).map((sku) => variantValue(sku.model, sku.color, sku.storage));
    if (covered.length > 0) await this.preferences.muteAll(chatId, 'variant', covered);
    if (mutes.model.has(model)) await this.preferences.unmute(chatId, 'model', [model]);
    await this.preferences.unmute(chatId, 'color', [...new Set(variants.map((sku) => scopedValue(model, sku.color)))]);
    await this.preferences.unmute(chatId, 'storage', [...new Set(variants.map((sku) => scopedValue(model, sku.storage)))]);
  }

  /// One model -> go straight to its page; several -> pick a model first.
  private async alertsHomeMenu(chatId: string): Promise<Menu> {
    const [skus, mutes] = await Promise.all([this.visibleSkus(chatId), this.preferences.getMutes(chatId)]);
    if (modelsOf(skus).length === 1) return alertsModel(skus, 0, mutes) ?? alertsHome(skus, mutes);
    return alertsHome(skus, mutes);
  }

  private async alertsModelMenu(chatId: string, modelIndex: number): Promise<Menu> {
    const [skus, mutes] = await Promise.all([this.visibleSkus(chatId), this.preferences.getMutes(chatId)]);
    return alertsModel(skus, modelIndex, mutes) ?? alertsHome(skus, mutes);
  }

  /// No model -> everything in stock across every model (what /stock shows).
  /// A model index -> that model in full, including what is sold out.
  private async stockMenu(chatId: string, modelIndex: number | null): Promise<Menu> {
    const models = modelsOf(await this.visibleSkus(chatId));
    const mutes = await this.preferences.getMutes(chatId).catch(() => null);
    const muted = (sku: Parameters<typeof isMuted>[1]): boolean => (mutes ? isMuted(mutes, sku) : false);
    const model = modelIndex === null ? undefined : models[modelIndex];
    const paused = await this.pauses.pausedModels();
    const load = async (name: string) => ({ ...(await this.currentStock.forModel(name)), paused: paused.has(name) });
    if (!model || modelIndex === null) {
      return stockAll(await Promise.all(models.map(load)), muted);
    }
    return stockView(await load(model), modelIndex, models.length > 1, muted);
  }

  /// What a chat may see. Paused models are hidden from members entirely -
  /// as far as they can tell the bot is simply not watching that model.
  /// Owners see everything, paused models included.
  private async visibleSkus(chatId: string): Promise<SkuOption[]> {
    const skus = await this.history.listSkus();
    if (this.recipients.isAdmin(chatId)) return skus;
    const paused = await this.pauses.pausedModels();
    return skus.filter((sku) => !paused.has(sku.model));
  }

  private async historyHomeMenu(chatId: string): Promise<Menu> {
    const [skus, counts] = await Promise.all([this.visibleSkus(chatId), this.history.restockCounts()]);
    return historyHome(skus, counts, this.history.retentionDays());
  }

  private async sendMenu(chatId: string, menu: Menu | (() => Promise<Menu>)): Promise<void> {
    try {
      const resolved = typeof menu === 'function' ? await menu() : menu;
      await telegramNotificationService.sendMenu(chatId, resolved.text, resolved.keyboard);
    } catch {
      logger.error('Telegram menu query failed');
      await telegramNotificationService.reply(chatId, '😵 เปิดเมนูไม่ได้ ลองใหม่อีกครั้งนะ');
    }
  }

  // -- Status text ------------------------------------------------------------

  private schedulerText(): string {
    const schedule = [
      env.STOCK_CHECK_WINDOW_ENABLED
        ? '🕠 เช็คของทุกวัน 05:30–22:00 น.'
        : '🕐 เช็คของตลอดวัน',
      env.STOCK_CHECK_CRON
        ? `🔁 รอบเช็ค: ${env.STOCK_CHECK_CRON}`
        : '🔁 พักหลังจบรอบ: 08:00–09:00 น. สุ่ม 10–15 วินาที ช่วงอื่น 30 วินาที (เวลาไทย)',
      '🌙 นอกเวลาบอทจะพัก แล้วเริ่มเองเมื่อถึงเวลา',
    ].filter((line) => env.STOCK_CHECK_WINDOW_ENABLED || !line.startsWith('🌙')).join('\n');
    return `${stockScheduler.getStatusText()}\n${schedule}`;
  }

  private async pausedLine(): Promise<string> {
    const paused = [...(await this.pauses.pausedModels())];
    return paused.length > 0 ? `\n⏸️ หยุดเช็คอยู่: ${paused.join(', ')} (/models)` : '';
  }

  private async statusText(admin = false): Promise<string> {
    const status = `${this.schedulerText()}${await this.pausedLine()}`;
    const help = admin
      ? '⏸️ /pause หยุดเช็ค    ▶️ /resume เริ่มต่อ\n🏠 /menu เมนูหลัก'
      : '🏠 /menu เมนูหลัก';
    try {
      const snapshot = await readStatus();
      return `${status}\n\n${buildStatusMessage(snapshot).text}\n\n${help}`;
    } catch {
      logger.error('Telegram status query failed');
      return `${status}\n\n😵 อ่านผลเช็คล่าสุดไม่ได้ ลองใหม่อีกครั้งนะ`;
    }
  }

  private async poll(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
          body: JSON.stringify({ offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }),
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
