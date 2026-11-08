import { storageRank } from '../apple/apple.parser.js';
import {
  buildRestockHistoryText,
  type RestockEvent,
  type SkuOption,
  periodLabel,
} from '../stock/restock.history.js';
import { dbDateKey, formatDateKey, formatFriendly, formatThaiDateTime } from '../utils/datetime.js';
import { isMuted, type Mutes } from './alert.filter.js';
import type { Subscriber } from './telegram.recipients.js';
import {
  buildAllStockText,
  buildCurrentStockText,
  type CurrentModelStock,
  type CurrentSku,
} from '../stock/stock.current.js';
import type { InlineButton, InlineKeyboard } from './telegram.service.js';

/**
 * Pure builders for the Telegram inline-keyboard menus.
 *
 * callback_data (max 64 bytes):
 *   m                main menu          st            status
 *   a                alert settings     am:<mi>       one model's variants
 *   av:<mi>:<i>      toggle variant <i> of model <mi> (index into variantsOf)
 *   avon:<mi> avoff:<mi>  every variant of a model on / off
 *   areset           everything on
 *   s                stock: pick model  sm:<mi>       one model incl. sold-out list
 *   sa               stock, every model at once (also /stock)
 *   h                history models     hm:<mi>       one model's SKUs
 *   hv:<variantId>   one SKU's restock history
 *   sl               members (admin)    sx:<chatId>   remove a member (admin)
 *   inv              send the invite messages (admin)
 *   ja:<chatId> jr:<chatId>  approve / reject a join request (admin)
 *   ex:<chatId>      expiry picker for a member (admin)
 *   es:<days>:<chatId>  set expiry to today + <days>; 0 = never (admin)
 *   ec:<chatId>      type the expiry date (admin)   ecx  stop waiting for it
 *   mo               model checks (admin)  mp:<mi>  pause / resume one model (admin)
 *   nw               write a news message to members (admin)
 *   nws nwx          send the drafted news / drop it (admin)
 *   x                section label, does nothing
 * where <mi> indexes modelsOf(skus).
 */
export interface Menu {
  text: string;
  keyboard: InlineKeyboard;
}

const button = (text: string, data: string): InlineButton => ({ text, callback_data: data });
const rows = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};
const BACK_MAIN = button('🏠 เมนูหลัก', 'm');
const ofLabel = (count: number, total: number): string => `${count} จาก ${total} แบบ`;

/// How a button names a model: by its name, so a button left in a chat keeps
/// meaning the same model even after another model is paused and the list a
/// member sees gets shorter. "#<index>" only for absurdly long names.
export const modelRef = (model: string, index: number): string =>
  Buffer.byteLength(model, 'utf8') <= 40 && !model.includes(':') ? model : `#${index}`;

/// Models in catalogue order.
export const modelsOf = (skus: readonly SkuOption[]): string[] => [...new Set(skus.map((sku) => sku.model))];

const enabledCount = (skus: readonly SkuOption[], mutes: Mutes): number =>
  skus.filter((sku) => !isMuted(mutes, sku)).length;

/// One line describing what a chat gets for a model.
const modelSummary = (ofModel: readonly SkuOption[], mutes: Mutes): string => {
  const enabled = enabledCount(ofModel, mutes);
  if (enabled === ofModel.length) return `✅ เตือนทุกแบบ (${ofModel.length} แบบ)`;
  if (enabled === 0) return '🔕 ปิดเตือนทุกแบบ';
  return `✅ เตือน ${ofLabel(enabled, ofModel.length)}`;
};

/// A model's variants in a fixed order (size, then color). Indexes into this
/// list are what the toggle buttons carry.
export const variantsOf = (skus: readonly SkuOption[], model: string): SkuOption[] =>
  skus
    .filter((sku) => sku.model === model)
    .sort((a, b) => storageRank(a.storage) - storageRank(b.storage) || a.colorTh.localeCompare(b.colorTh));

export const alertsHome = (skus: readonly SkuOption[], mutes: Mutes): Menu => {
  const models = modelsOf(skus);
  const enabled = enabledCount(skus, mutes);
  const lines = ['🔔 ตั้งค่าการแจ้งเตือน', ''];
  if (skus.length === 0) {
    lines.push('⏳ ยังไม่มีข้อมูลสินค้า รอบอทเช็คครั้งแรกก่อนนะ');
  } else {
    for (const model of models) lines.push(`📱 ${model}`, `   ${modelSummary(variantsOf(skus, model), mutes)}`, '');
    lines.push(enabled === 0
      ? '⚠️ ตอนนี้ปิดการเตือนหมดทุกแบบ จะไม่ได้รับแจ้งเตือนเลย'
      : `📊 เตือนอยู่ ${ofLabel(enabled, skus.length)}`);
    lines.push('', '👇 เลือกรุ่นเพื่อเลือกแบบที่อยากให้เตือน');
  }
  return {
    text: lines.join('\n'),
    keyboard: [
      ...models.map((model, index) => [button(`📱 ${model}`, `am:${modelRef(model, index)}`)]),
      [button('🔔 เปิดเตือนทุกอย่าง', 'areset')],
      [BACK_MAIN],
    ],
  };
};

export const alertsModel = (skus: readonly SkuOption[], modelIndex: number, mutes: Mutes): Menu | null => {
  const models = modelsOf(skus);
  const model = models[modelIndex];
  if (!model) return null;
  const variants = variantsOf(skus, model);
  const enabled = enabledCount(variants, mutes);

  const lines = ['🔔 ตั้งค่าการแจ้งเตือน', `📱 ${model}`, ''];
  lines.push(enabled === 0 ? '🔕 ตอนนี้ปิดเตือนทุกแบบของรุ่นนี้' : `📊 เตือนอยู่ ${ofLabel(enabled, variants.length)}`);
  lines.push('', '👇 แตะแต่ละแบบเพื่อเปิด/ปิด', '✅ = เตือน    🔕 = ไม่เตือน');

  return {
    text: lines.join('\n'),
    keyboard: [
      [button('✅ เปิดทุกแบบ', `avon:${modelRef(model, modelIndex)}`), button('🔕 ปิดทุกแบบ', `avoff:${modelRef(model, modelIndex)}`)],
      ...rows(
        variants.map((sku, index) =>
          button(`${isMuted(mutes, sku) ? '🔕' : '✅'} ${sku.colorTh} ${sku.storage}`, `av:${modelRef(model, modelIndex)}:${index}`),
        ),
        2,
      ),
      models.length > 1 ? [button('⬅️ เลือกรุ่นอื่น', 'a'), BACK_MAIN] : [BACK_MAIN],
    ],
  };
};

/// Asked first when the 📦 button is tapped: which model to look at.
export const stockPicker = (models: readonly string[], paused: ReadonlySet<string>): Menu => ({
  text: ['📦 ของที่มีตอนนี้', '', '👇 อยากดูรุ่นไหน'].join('\n'),
  keyboard: [
    ...models.map((model, index) => [
      button(paused.has(model) ? `⏸️ ${model} (หยุดเช็คอยู่)` : `📱 ${model}`, `sm:${modelRef(model, index)}`),
    ]),
    ...(models.length > 1 ? [[button('📦 ดูทุกรุ่นพร้อมกัน', 'sa')]] : []),
    [BACK_MAIN],
  ],
});

/// Everything in stock right now, every model in one message.
export const stockAll = (
  stocks: readonly CurrentModelStock[],
  isMutedSku: (sku: CurrentSku) => boolean = () => false,
): Menu => ({
  text: buildAllStockText(stocks, isMutedSku),
  keyboard: [
    [button('🔄 อัปเดต', 'sa')],
    ...(stocks.length > 1
      ? stocks.map((stock, index) => [button(`📋 ดู ${stock.model} ทุกแบบ`, `sm:${modelRef(stock.model, index)}`)])
      : stocks.length === 1
        ? [[button('📋 ดูทุกแบบ (รวมที่หมด)', `sm:${modelRef(stocks[0]!.model, 0)}`)]]
        : []),
    [BACK_MAIN],
  ],
});

export const stockView = (
  stock: CurrentModelStock,
  modelIndex: number,
  multiModel: boolean,
  isMutedSku: (sku: CurrentSku) => boolean = () => false,
): Menu => ({
  text: buildCurrentStockText(stock, isMutedSku),
  keyboard: [
    [button('🔄 อัปเดต', `sm:${modelRef(stock.model, modelIndex)}`), ...(multiModel ? [button('⬅️ เลือกรุ่นอื่น', 's')] : [])],
    [BACK_MAIN],
  ],
});

const shortSku = (sku: SkuOption): string => `${sku.colorTh} ${sku.storage}`;
const times = (count: number): string => (count > 0 ? `${count} ครั้ง` : '-');

/// With several models, pick a model first so the list stays short.
export const historyHome = (skus: readonly SkuOption[], counts: ReadonlyMap<string, number>, days: number): Menu => {
  const models = modelsOf(skus);
  if (models.length <= 1) return historyModel(skus, counts, days, 0) ?? historyEmpty();
  const total = (model: string): number =>
    skus.filter((sku) => sku.model === model).reduce((sum, sku) => sum + (counts.get(sku.variantId) ?? 0), 0);
  return {
    text: [
      '📈 สถิติของเคยเข้า',
      '',
      '👇 เลือกรุ่นที่อยากดู',
      `🔢 ตัวเลขบนปุ่ม = จำนวนครั้งที่ของเข้าใน ${periodLabel(days)}ที่ผ่านมา`,
    ].join('\n'),
    keyboard: [
      ...models.map((model, index) => [button(`📱 ${model} · ${times(total(model))}`, `hm:${modelRef(model, index)}`)]),
      [BACK_MAIN],
    ],
  };
};

const historyEmpty = (): Menu => ({
  text: ['📈 สถิติของเคยเข้า', '', '⏳ ยังไม่มีข้อมูลสินค้า รอบอทเช็คครั้งแรกก่อนนะ'].join('\n'),
  keyboard: [[BACK_MAIN]],
});

export const historyModel = (
  skus: readonly SkuOption[],
  counts: ReadonlyMap<string, number>,
  days: number,
  modelIndex: number,
): Menu | null => {
  const models = modelsOf(skus);
  const model = models[modelIndex];
  if (!model) return null;
  return {
    text: [
      '📈 สถิติของเคยเข้า',
      `📱 ${model}`,
      '',
      '👇 เลือกสีและความจุที่อยากดู',
      `🔢 ตัวเลขบนปุ่ม = จำนวนครั้งที่ของเข้าใน ${periodLabel(days)}ที่ผ่านมา`,
    ].join('\n'),
    keyboard: [
      ...rows(
        skus
          .filter((sku) => sku.model === model)
          .map((sku) => button(`${shortSku(sku)} · ${times(counts.get(sku.variantId) ?? 0)}`, `hv:${sku.variantId}`)),
        2,
      ),
      models.length > 1 ? [button('⬅️ เลือกรุ่นอื่น', 'h'), BACK_MAIN] : [BACK_MAIN],
    ],
  };
};

export const historyView = (
  sku: SkuOption,
  events: readonly RestockEvent[],
  days: number,
  modelIndex = 0,
): Menu => ({
  text: buildRestockHistoryText(sku, events, days),
  keyboard: [
    [button('🔄 อัปเดต', `hv:${sku.variantId}`), button('⬅️ เลือกแบบอื่น', `hm:${modelRef(sku.model, modelIndex)}`)],
    [BACK_MAIN],
  ],
});

/// Members never see a list of models: a message stays in the chat, and a
/// model paused later must not be revealed by an old menu. Owners do.
export const mainMenu = (models: string, admin = false): Menu => ({
  text: ['🍎 บอทเฝ้าของ iPhone', ...(admin ? [`📱 ${models}`] : []), '', '👇 เลือกเมนูได้เลย'].join('\n'),
  keyboard: [
    [button('📦 ของที่มีตอนนี้', 's')],
    [button('🔔 ตั้งค่าการแจ้งเตือน', 'a')],
    [button('📈 ดูสถิติของเคยเข้า', 'h')],
    ...(admin
      ? [
          [button('📊 สถิติเติมของตามวัน / เวลา', 'rs')],
          [button('⏯️ หยุด/เริ่มเช็คแต่ละรุ่น', 'mo')],
          [button('📊 สถานะบอท', 'st')],
          [button('🔗 ส่งคำเชิญ', 'inv'), button('👥 ดูสมาชิก', 'sl')],
          [button('📣 ส่งข้อความถึงสมาชิก', 'nw')],
          [button('💬 ส่งข้อความรายคน', 'dml:0')],
          [button('💳 ตั้งราคาค่าสมาชิก', 'fee')],
        ]
      : []),
  ],
});

export const subscriberName = (subscriber: Pick<Subscriber, 'name' | 'username' | 'chatId'>): string =>
  [subscriber.name, subscriber.username ? `@${subscriber.username}` : null].filter(Boolean).join(' ') ||
  subscriber.chatId;

export const inviteLink = (botUsername: string | null, code: string): string | null =>
  botUsername && code ? `https://t.me/${botUsername}?start=${code}` : null;

/// Owner: who is subscribed, with a button to remove each one.
export const membersMenu = (
  subscribers: readonly Subscriber[],
  adminCount: number,
  pending: readonly Subscriber[] = [],
): Menu => {
  const lines = [
    '👥 สมาชิก',
    '',
    `👑 เจ้าของบอท: ${adminCount} แชท`,
    `🙋 สมาชิกที่เข้าผ่านลิงก์: ${subscribers.length} คน`,
    ...subscribers.map((s) => `   • ${subscriberName(s)} (เข้าเมื่อ ${formatThaiDateTime(s.joinedAt).slice(0, 10)} · ${expiryLabel(s)})`),
    '',
  ];
  if (pending.length > 0) {
    lines.push(
      `⏳ รออนุมัติ: ${pending.length} คน`,
      ...pending.map((s) => `   • ${subscriberName(s)} (ขอเมื่อ ${formatThaiDateTime(s.joinedAt).slice(0, 10)})`),
      '',
    );
  }
  lines.push(subscribers.length > 0 ? '👇 แตะ 📅 เพื่อตั้งวันหมดอายุ · ❌ เพื่อนำคนออก (เขาจะไม่ได้รับแจ้งเตือนอีก)' : 'ℹ️ ยังไม่มีสมาชิก ชวนคนได้ที่ 🔗 ส่งคำเชิญ (/invite)');
  return {
    text: lines.join('\n'),
    keyboard: [
      ...pending.map((s) => [
        button(`✅ อนุมัติ: ${subscriberName(s)}`.slice(0, 40), `ja:${s.chatId}`),
        button('❌ ปฏิเสธ', `jr:${s.chatId}`),
      ]),
      ...subscribers.map((s) => [
        button('📅', `ex:${s.chatId}`),
        button(`❌ นำออก: ${subscriberName(s)}`.slice(0, 60), `sx:${s.chatId}`),
      ]),
      [button('🔄 อัปเดต', 'sl'), button('🔗 ส่งคำเชิญ', 'inv')],
      [BACK_MAIN],
    ],
  };
};

/// "หมดอายุ 31/12/2026" or "ไม่มีวันหมดอายุ".
export const expiryLabel = (subscriber: Pick<Subscriber, 'expiresOn'>): string =>
  subscriber.expiresOn ? `หมดอายุ ${formatDateKey(dbDateKey(subscriber.expiresOn))}` : 'ไม่มีวันหมดอายุ';

/// Quick picks offered after approving someone (and from 📅 in /members).
export const EXPIRY_PRESETS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: '7 วัน' },
  { days: 30, label: '1 เดือน' },
  { days: 90, label: '3 เดือน' },
  { days: 180, label: '6 เดือน' },
  { days: 365, label: '1 ปี' },
];

/// Owner: "when does this member expire?" - `heading` is e.g. the approval result.
export const expiryPicker = (subscriber: Subscriber, checkHour: number, heading?: string): Menu => ({
  text: [
    ...(heading ? [heading, ''] : []),
    `📅 สมาชิก ${subscriberName(subscriber)} หมดอายุวันไหน?`,
    `ตอนนี้: ${expiryLabel(subscriber)}`,
    '',
    `⌛ ถึงวันหมดอายุ ระบบจะนำออกตอน ${String(checkHour).padStart(2, '0')}:00 น. แล้วแจ้งรายงานให้`,
  ].join('\n'),
  keyboard: [
    EXPIRY_PRESETS.slice(0, 3).map((p) => button(p.label, `es:${p.days}:${subscriber.chatId}`)),
    [
      ...EXPIRY_PRESETS.slice(3).map((p) => button(p.label, `es:${p.days}:${subscriber.chatId}`)),
      button('♾️ ไม่หมดอายุ', `es:0:${subscriber.chatId}`),
    ],
    [button('✏️ พิมพ์วันที่เอง', `ec:${subscriber.chatId}`)],
    [button('👥 ดูสมาชิก', 'sl')],
  ],
});

/// Owner: waiting for a typed date.
export const expiryPrompt = (subscriber: Subscriber): Menu => ({
  text: [
    `✏️ พิมพ์วันหมดอายุของ ${subscriberName(subscriber)} ส่งมาได้เลย`,
    '',
    'ตัวอย่าง:',
    '   • 31/12/2026 หรือ 31/12/2569',
    '   • 45  (= อีก 45 วันนับจากวันนี้)',
  ].join('\n'),
  keyboard: [[button('↩️ ยกเลิก', 'ecx')]],
});

/**
 * Owner: the invite, as two messages. The first is the link for the owner
 * (exactly what to share); the second is written for the person being invited,
 * so it can simply be forwarded as it is.
 */
/// No model names on purpose: a forwarded invite lives forever, and must not
/// reveal a model that gets paused later.
export const inviteMessages = (link: string | null, inviteConfigured: boolean): string[] => {
  if (!inviteConfigured) {
    return [['🔗 ยังไม่ได้ตั้งลิงก์เชิญ', '⚙️ ใส่ TELEGRAM_INVITE_CODE ในไฟล์ .env แล้วรีสตาร์ทบอท'].join('\n')];
  }
  if (!link) return ['🔗 ดึงลิงก์เชิญไม่ได้ตอนนี้ ลองใหม่อีกครั้งนะ'];
  return [
    ['🔗 ลิงก์เชิญ — ส่งให้คนที่อยากรับแจ้งเตือน', link, '', '👇 หรือกดส่งต่อ (Forward) ข้อความด้านล่างได้เลย'].join('\n'),
    [
      '🍎 ชวนมารับแจ้งเตือน iPhone เข้าสต็อก!',
      '',
      '🔔 ของเข้า Apple Store ในไทยเมื่อไหร่ บอทเตือนทันที',
      '',
      '✨ ทำอะไรได้บ้าง',
      '   ✅ เลือกได้ว่าอยากให้เตือนสีไหน ความจุไหน',
      '   📦 ดูได้ทุกเมื่อว่าตอนนี้มีของที่สาขาไหน',
      '   📈 ดูสถิติว่าของมักเข้าช่วงเวลาไหน',
      '',
      '👇 กดลิงก์นี้ แล้วกด Start ได้เลย',
      link,
    ].join('\n'),
  ];
};

/// Admin: pause or resume checking one model at a time.
export const modelChecksMenu = (models: readonly string[], paused: ReadonlyMap<string, Date>): Menu => {
  const lines = ['⏯️ หยุด/เริ่มเช็คแต่ละรุ่น', ''];
  if (models.length === 0) lines.push('⏳ ยังไม่มีข้อมูลสินค้า รอบอทเช็คครั้งแรกก่อนนะ');
  for (const model of models) {
    const since = paused.get(model);
    lines.push(`📱 ${model}`, since ? `   ⏸️ หยุดเช็คอยู่ (ตั้งแต่ ${formatFriendly(since)})` : '   ▶️ กำลังเช็คตามปกติ', '');
  }
  lines.push(
    '👇 แตะเพื่อหยุดหรือเริ่มเช็ครุ่นนั้น',
    'ℹ️ รุ่นที่หยุด จะไม่ถูกเช็คและไม่มีการแจ้งเตือน',
    'ℹ️ มีผลกับทุกคน และยังหยุดอยู่แม้รีสตาร์ทบอท',
  );
  return {
    text: lines.join('\n'),
    keyboard: [
      ...models.map((model, index) => [
        button(paused.has(model) ? `▶️ เริ่มเช็ค ${model}` : `⏸️ หยุดเช็ค ${model}`, `mp:${index}`),
      ]),
      [button('🔄 อัปเดต', 'mo'), BACK_MAIN],
    ],
  };
};

export const statusMenu = (text: string): Menu => ({
  text,
  keyboard: [[button('🔄 อัปเดต', 'st'), BACK_MAIN]],
});

// -- News to members (admin) ---------------------------------------------------

/// Room left for the heading members see above the owner's text.
export const NEWS_MAX_LENGTH = 3800;
const NEWS_HEADING = '📢 ข่าวจากแอดมิน';

/// Exactly what each member receives.
export const newsMessage = (text: string): string => `${NEWS_HEADING}\n\n${text}`;

/// Owner: waiting for the news text.
export const newsPrompt = (memberCount: number): Menu => ({
  text: [
    '📣 ส่งข้อความถึงสมาชิก',
    '',
    `👥 จะส่งถึงสมาชิก ${memberCount} คน`,
    '✏️ พิมพ์ข้อความที่อยากแจ้ง ส่งมาได้เลย (หลายบรรทัดได้)',
    'ℹ️ ส่งแล้วบอทจะให้ดูตัวอย่างก่อน ยังไม่ส่งจริงจนกว่าจะกดยืนยัน',
  ].join('\n'),
  keyboard: [[button('↩️ ยกเลิก', 'nwx')]],
});

/// Owner: preview + confirm.
export const newsPreview = (text: string, memberCount: number): Menu => ({
  text: [
    `👀 ตัวอย่างข้อความ (ส่งถึงสมาชิก ${memberCount} คน)`,
    '──────────',
    newsMessage(text),
    '──────────',
    memberCount > 0 ? '👇 ส่งเลยไหม · พิมพ์ข้อความใหม่มาเพื่อแก้ได้เลย' : 'ℹ️ ยังไม่มีสมาชิกให้ส่ง',
  ].join('\n'),
  keyboard: [
    ...(memberCount > 0 ? [[button(`✅ ส่งเลย (${memberCount} คน)`, 'nws')]] : []),
    [button('❌ ยกเลิก', 'nwx')],
  ],
});

/// Owner: how the broadcast went.
export const newsResult = (sent: number, failed: readonly string[]): string => [
  `✅ ส่งข้อความถึงสมาชิกแล้ว ${sent} คน`,
  ...(failed.length > 0 ? [`⚠️ ส่งไม่ถึง ${failed.length} คน: ${failed.join(', ')}`, 'ℹ️ อาจบล็อกบอทหรือลบแชทไปแล้ว'] : []),
].join('\n');

export const directMessageText = (text: string): string => `💬 ข้อความจากเจ้าของบอท\n\n${text}`;

export const directMessageMembers = (people: readonly Subscriber[], requestedPage = 0): Menu => {
  const pageSize = 8;
  const lastPage = Math.max(0, Math.ceil(people.length / pageSize) - 1);
  const page = Math.min(Math.max(0, requestedPage), lastPage);
  const navigation = [
    ...(page > 0 ? [button('⬅️ ก่อนหน้า', `dml:${page - 1}`)] : []),
    ...(page < lastPage ? [button('ถัดไป ➡️', `dml:${page + 1}`)] : []),
  ];
  return {
    text: people.length ? `💬 ส่งข้อความรายคน\nเลือกสมาชิกที่ต้องการส่ง (หน้า ${page + 1}/${lastPage + 1})` : '👥 ยังไม่มีสมาชิกให้ส่งข้อความ',
    keyboard: [
      ...people.slice(page * pageSize, (page + 1) * pageSize).map((person) => [
        button(`👤 ${subscriberName(person)}`.slice(0, 60), `dm:${person.chatId}`),
      ]),
      ...(navigation.length ? [navigation] : []),
      [button('🏠 เมนูหลัก', 'm')],
    ],
  };
};
