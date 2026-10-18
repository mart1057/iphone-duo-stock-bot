import type { FlexMessage } from './line.flex.js';

/**
 * One notification rendered for every channel we support.
 *
 * LINE renders Flex bubbles; Telegram and Discord take plain text. Building
 * both up front keeps the fan-out dumb - a channel simply picks the shape it
 * understands instead of re-deriving the content.
 */
export interface OutboundMessage {
  /// Automatic system notices are excluded from LINE and Telegram.
  kind?: 'stock' | 'system';
  /// Intentional second stock copy; LINE skips this reminder.
  stockReminder?: boolean;
  /// Channels to skip for this message (e.g. ['line'] for test sends, to save quota).
  excludeChannels?: readonly string[];
  /// Rich rendering, used by LINE.
  flex: FlexMessage;
  /// Plain-text rendering, used by Telegram / Discord and by logs.
  text: string;
  /// When true, Discord gets a second reminder a few seconds after the first
  /// - the other channels still send exactly once.
  repeatDiscord?: boolean;
}

export interface ChannelResult {
  channel: string;
  success: boolean;
  messageId: string | null;
  /// True when the channel is simply not configured - not an error.
  skipped: boolean;
  error?: string;
}

export interface NotificationChannel {
  readonly name: string;
  /// False when the channel has no credentials configured.
  isConfigured(): boolean;
  /**
   * False when the channel is configured but temporarily unusable - e.g. LINE
   * after its monthly quota is gone. Calling it would only produce errors, so
   * the dispatcher skips it until it heals. Defaults to available.
   */
  isAvailable?(): boolean;
  send(message: OutboundMessage, retryKey?: string): Promise<ChannelResult>;
}
