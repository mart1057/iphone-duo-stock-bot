import { memberExpiryService, type MemberExpiryService } from '../notification/member.expiry.js';
import { logger } from '../utils/logger.js';

const HOUR_MS = 60 * 60 * 1000;

/// Checks member expiry every hour (and shortly after startup), so a bot that
/// was down at the check hour still catches up the same day.
export class MemberExpiryScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;

  constructor(private readonly service: Pick<MemberExpiryService, 'run'> = memberExpiryService) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(30_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.service
        .run()
        .then(() => undefined)
        .catch((error: unknown) => logger.error('Member expiry check failed - will retry next hour', error))
        .finally(() => {
          this.running = null;
          this.schedule(HOUR_MS);
        });
    }, delay);
  }
}

export const memberExpiryScheduler = new MemberExpiryScheduler();
