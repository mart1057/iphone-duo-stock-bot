import { env } from '../config/env.js';
import type { StockTransition } from '../stock/stock.types.js';
import { formatClock, formatThaiDateTime } from '../utils/datetime.js';

/// Minimal Flex typings - enough to stay type-safe without pulling in the SDK.
export interface FlexComponent {
  type: string;
  [key: string]: unknown;
}

export interface FlexBubble {
  type: 'bubble';
  size?: 'nano' | 'micro' | 'kilo' | 'mega' | 'giga';
  header?: FlexComponent;
  body?: FlexComponent;
  footer?: FlexComponent;
  styles?: Record<string, unknown>;
}

export interface FlexCarousel {
  type: 'carousel';
  contents: FlexBubble[];
}

export interface FlexMessage {
  type: 'flex';
  altText: string;
  contents: FlexBubble | FlexCarousel;
}

const APPLE_RED = '#BF0A30';
const DARK = '#1D1D1F';
const MUTED = '#86868B';
const GREEN = '#34C759';

/// LINE rejects carousels with more than 12 bubbles.
const MAX_BUBBLES = 10;

const thb = (value: number | null): string | null =>
  value === null ? null : `฿${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const labelValue = (label: string, value: string): FlexComponent => ({
  type: 'box',
  layout: 'baseline',
  spacing: 'sm',
  contents: [
    { type: 'text', text: label, color: MUTED, size: 'sm', flex: 3 },
    { type: 'text', text: value, wrap: true, color: DARK, size: 'sm', flex: 7, weight: 'bold' },
  ],
});

const storeButton = (url: string): FlexComponent => ({
  type: 'button',
  style: 'primary',
  height: 'sm',
  color: APPLE_RED,
  action: { type: 'uri', label: 'ดู Apple Store', uri: url },
});

const header = (title: string, subtitle: string): FlexComponent => ({
  type: 'box',
  layout: 'vertical',
  backgroundColor: DARK,
  paddingAll: '16px',
  contents: [
    { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'lg' },
    { type: 'text', text: subtitle, color: '#D2D2D7', size: 'xs', margin: 'sm' },
  ],
});

export const buildStockBubble = (transition: StockTransition): FlexBubble => {
  const { stock } = transition;
  const price = thb(stock.priceTHB);

  const rows: FlexComponent[] = [
    labelValue('Color', `${stock.colorTh} (${stock.color})`),
    labelValue('Storage', stock.storage),
    labelValue('Store', stock.storeName),
    labelValue('Status', '🟢 AVAILABLE'),
    labelValue('Checked', formatClock(stock.checkedAt)),
  ];
  if (price) rows.splice(2, 0, labelValue('Price', price));

  return {
    type: 'bubble',
    size: 'mega',
    header: header('🍎 STOCK ALERT', formatThaiDateTime(stock.checkedAt)),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: stock.model, weight: 'bold', size: 'xl', color: DARK, wrap: true },
        {
          type: 'text',
          text: stock.quote ?? 'พร้อมจำหน่าย',
          size: 'sm',
          color: GREEN,
          weight: 'bold',
        },
        { type: 'separator', margin: 'md' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: rows },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [storeButton(env.APPLE_PRODUCT_URL)],
    },
  };
};

const summaryLine = (transition: StockTransition, index: number): FlexComponent => ({
  type: 'box',
  layout: 'vertical',
  margin: 'md',
  contents: [
    {
      type: 'text',
      text: `${index + 1}. ${transition.stock.colorTh} · ${transition.stock.storage}`,
      weight: 'bold',
      size: 'sm',
      color: DARK,
      wrap: true,
    },
    {
      type: 'text',
      text: `📍 ${transition.stock.storeName}`,
      size: 'xs',
      color: MUTED,
      wrap: true,
    },
  ],
});

export const buildSummaryBubble = (transitions: readonly StockTransition[]): FlexBubble => {
  const checkedAt = transitions[0]?.stock.checkedAt ?? new Date();
  const model = transitions[0]?.stock.model ?? env.APPLE_MODEL_FILTER;
  const shown = transitions.slice(0, 20);
  const rest = transitions.length - shown.length;

  const contents: FlexComponent[] = [
    { type: 'text', text: model, weight: 'bold', size: 'xl', color: DARK, wrap: true },
    {
      type: 'text',
      text: `🟢 พบสินค้า ${transitions.length} รายการ`,
      size: 'sm',
      color: GREEN,
      weight: 'bold',
      margin: 'sm',
    },
    { type: 'separator', margin: 'md' },
    ...shown.map(summaryLine),
  ];

  if (rest > 0) {
    contents.push({ type: 'text', text: `และอีก ${rest} รายการ`, size: 'xs', color: MUTED, margin: 'md' });
  }

  return {
    type: 'bubble',
    size: 'mega',
    header: header('🍎 STOCK ALERT', formatThaiDateTime(checkedAt)),
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [storeButton(env.APPLE_PRODUCT_URL)],
    },
  };
};

/**
 * System notice (rate-limit cooldown / recovery). Visually distinct from a
 * stock alert so it can never be mistaken for "there is stock".
 */
export const buildSystemMessage = (
  title: string,
  headline: string,
  rows: ReadonlyArray<[string, string]>,
  tone: 'warn' | 'ok' = 'warn',
): FlexMessage => {
  const accent = tone === 'ok' ? GREEN : '#FF9500';

  return {
    type: 'flex',
    altText: `${title} - ${headline}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: header(title, formatThaiDateTime(new Date())),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: headline, weight: 'bold', size: 'md', color: accent, wrap: true },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            margin: 'md',
            contents: rows.map(([label, value]) => labelValue(label, value)),
          },
        ],
      },
    },
  };
};

export const buildAltText = (transitions: readonly StockTransition[]): string => {
  const first = transitions[0];
  if (!first) return '🍎 STOCK ALERT';
  if (transitions.length === 1) {
    return `🍎 ${first.stock.model} ${first.stock.colorTh} ${first.stock.storage} พร้อมจำหน่ายที่ ${first.stock.storeName}`;
  }
  return `🍎 ${first.stock.model} พร้อมจำหน่าย ${transitions.length} รายการ`;
};

/**
 * One transition  -> a single detail bubble.
 * A few           -> a carousel of detail bubbles.
 * Many            -> one summary bubble (LINE caps carousels at 12).
 */
export const buildStockAlertMessage = (transitions: readonly StockTransition[]): FlexMessage => {
  if (transitions.length === 0) throw new Error('buildStockAlertMessage requires >= 1 transition');

  const altText = buildAltText(transitions);

  if (transitions.length === 1) {
    return { type: 'flex', altText, contents: buildStockBubble(transitions[0] as StockTransition) };
  }

  if (transitions.length <= MAX_BUBBLES) {
    return {
      type: 'flex',
      altText,
      contents: {
        type: 'carousel',
        contents: [buildSummaryBubble(transitions), ...transitions.map(buildStockBubble)].slice(
          0,
          MAX_BUBBLES + 1,
        ),
      },
    };
  }

  return { type: 'flex', altText, contents: buildSummaryBubble(transitions) };
};

/// Plain-text fallback, also used by LINE_DRY_RUN logging.
export const buildPlainText = (transitions: readonly StockTransition[]): string => {
  const head = `🍎 ${transitions[0]?.stock.model ?? env.APPLE_MODEL_FILTER} STOCK ALERT`;

  if (transitions.length === 1) {
    const { stock } = transitions[0] as StockTransition;
    return [
      head,
      '',
      `🎨 สี: ${stock.colorTh}`,
      `💾 ความจุ: ${stock.storage}`,
      `📍 สาขา: ${stock.storeName}`,
      `🟢 สถานะ: พร้อมจำหน่าย`,
      `⏰ ตรวจพบ: ${formatThaiDateTime(stock.checkedAt)}`,
    ].join('\n');
  }

  // Apple has several physical stores, so - unlike True's single online
  // channel - the branch is not redundant and stays on every row.
  const items = transitions
    .map((t, i) => `${i + 1}. ${t.stock.colorTh} ${t.stock.storage} — ${t.stock.storeName}`)
    .join('\n');

  return [head, '', `🟢 พบสินค้า ${transitions.length} รายการ`, '', items].join('\n');
};

/// Plain-text twin of `buildSystemMessage`, for Telegram / Discord.
export const buildSystemPlainText = (
  title: string,
  headline: string,
  rows: ReadonlyArray<[string, string]>,
): string =>
  [
    title,
    '',
    headline,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `⏰ ${formatThaiDateTime(new Date())}`,
  ].join('\n');
