import { membershipSettings, formatMembershipPrice, type MembershipSettingsStore } from './membership.settings.js';
import { membershipReminders, type MembershipReminderStore } from './membership.reminders.js';
import { env } from '../config/env.js';
import { addDays, dateKey, dbDateKey, formatDateKey, hourOfDay } from '../utils/datetime.js';
import { logger } from '../utils/logger.js';
import { subscriberName } from './telegram.menus.js';
import { telegramAlertPreferences, type TelegramAlertPreferences } from './telegram.preferences.js';
import { telegramRecipients, type Subscriber, type TelegramRecipients } from './telegram.recipients.js';
import { telegramNotificationService } from './telegram.service.js';

type Sender = Pick<typeof telegramNotificationService, 'sendUnchecked' | 'clearCommands' | 'sendPaymentQr'>;

/// Admin report for the members removed today.
export const buildExpiryReport = (expired: readonly Subscriber[], today: string): string =>
  [
    `⌛ สมาชิกหมดอายุวันนี้ (${formatDateKey(today)}): ${expired.length} คน`,
    ...expired.map((s) => `   • ${subscriberName(s)}${s.expiresOn ? ` (หมดอายุ ${formatDateKey(dbDateKey(s.expiresOn))})` : ''}`),
    '',
    '🚪 นำออกจากรายชื่อรับแจ้งเตือนแล้ว',
    '👉 ถ้าจะให้กลับมา ส่งลิงก์เชิญ (/invite) แล้วกดอนุมัติใหม่',
  ].join('\n');

/**
 * Reminds members one day before expiry, then removes expired members and reports to the
 * admins. Runs from MEMBER_EXPIRY_CHECK_HOUR on the expiry day; a member is
 * removed once, so the report is never repeated.
 */
export class MemberExpiryService {
  constructor(
    private readonly recipients: TelegramRecipients = telegramRecipients,
    private readonly preferences: TelegramAlertPreferences = telegramAlertPreferences,
    private readonly telegram: Sender = telegramNotificationService,
    private readonly now: () => Date = () => new Date(),
    private readonly reminders: MembershipReminderStore = membershipReminders,
    private readonly membership: MembershipSettingsStore = membershipSettings,
  ) {}

  private async remindExpiringTomorrow(today: string, now: Date): Promise<void> {
    const tomorrow = addDays(today, 1);
    const members = await this.recipients.subscribers();
    for (const member of members) {
      if (!member.expiresOn || dbDateKey(member.expiresOn) !== tomorrow || this.recipients.isAdmin(member.chatId)) continue;
      let lease: Date | null = null;
      let delivered = false;
      try {
        const price = await this.membership.price();
        lease = await this.reminders.claim(member.chatId, tomorrow, now);
        if (!lease) continue;
        const text = [
          '⏳ สมาชิกของคุณจะหมดอายุในวันพรุ่งนี้',
          `📅 วันหมดอายุ: ${formatDateKey(tomorrow)} เวลา ${String(env.MEMBER_EXPIRY_CHECK_HOUR).padStart(2, '0')}:00 น. (เวลาไทย)`,
          '',
          price === null ? '💰 ยอดต่ออายุ: กรุณาสอบถามเจ้าของบอทก่อนชำระเงิน' : `💰 ยอดต่ออายุ: ${formatMembershipPrice(price)}`,
          '💳 สแกน QR เพื่อชำระค่าต่ออายุ แล้วส่งรูปสลิป ในแชตนี้',
          '⏳ เจ้าของบอทจะตรวจสอบยอดและต่ออายุให้',
          '🔔 บอทจะแจ้งเมื่อเจ้าของบอทอัปเดตวันหมดอายุแล้ว',
        ].join('\n');
        delivered = await this.telegram.sendPaymentQr(member.chatId, text);
        if (!delivered) {
          // Text fallback avoids losing the expiry notice; do not imply a QR was delivered.
          delivered = await this.telegram.sendUnchecked(member.chatId, text.replace(
            '💳 สแกน QR เพื่อชำระค่าต่ออายุ แล้วส่งรูปสลิป ในแชตนี้',
            '💳 ติดต่อเจ้าของบอทเพื่อขอ QR ชำระค่าต่ออายุ แล้วส่งรูปสลิป ในแชตนี้',
          ));
        }
        if (delivered) await this.reminders.complete(member.chatId, tomorrow, lease, this.now());
        else await this.reminders.release(member.chatId, tomorrow, lease);
      } catch {
        if (lease && !delivered) await this.reminders.release(member.chatId, tomorrow, lease).catch(() => undefined);
        logger.warn(`Could not deliver or record membership reminder chat=${member.chatId}; will retry next check`);
      }
    }
  }

  async run(): Promise<Subscriber[]> {
    const now = this.now();
    if (hourOfDay(now) < env.MEMBER_EXPIRY_CHECK_HOUR) return [];
    const today = dateKey(now);
    await this.remindExpiringTomorrow(today, now);

    const expired: Subscriber[] = [];
    for (const member of await this.recipients.expiredBy(today)) {
      if (!(await this.recipients.remove(member.chatId))) continue;
      expired.push(member);
      logger.info(`Telegram member expired chat=${member.chatId}`);
      await this.preferences.unmuteAll(member.chatId).catch(() => logger.warn('Could not clear filters of an expired member'));
      await this.telegram.clearCommands(member.chatId).catch(() => false);
      await this.telegram.sendUnchecked(member.chatId,
        '⌛ สิทธิ์รับการแจ้งเตือนของคุณหมดอายุแล้ว\n🙏 ถ้าต้องการใช้ต่อ ติดต่อเจ้าของบอทเพื่อขอลิงก์เชิญใหม่นะ').catch(() => false);
    }

    if (expired.length > 0) {
      const report = buildExpiryReport(expired, today);
      for (const admin of env.telegramChatIds) {
        await this.telegram.sendUnchecked(admin, report).catch(() => false);
      }
    }
    return expired;
  }
}

export const memberExpiryService = new MemberExpiryService();
