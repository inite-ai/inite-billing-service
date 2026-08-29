import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BacklogService } from '../health/backlog.service';
import { DistributedLockService } from '../common/locks/distributed-lock.service';

/**
 * Says out loud when work has stopped moving.
 *
 * Both outages this service has had looked identical from the outside: the
 * process up, the database reachable, `/health` green, and a queue quietly
 * filling behind a publisher that had stopped publishing. Nobody polls a
 * backlog endpoint that nobody knows to look at, so the numbers come to the
 * logs on their own — where a deploy's log stream and any alert built on
 * ERROR lines will carry them.
 */
@Injectable()
export class BacklogMonitorScheduler {
  private readonly logger = new Logger(BacklogMonitorScheduler.name);

  constructor(
    private readonly backlog: BacklogService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reportBacklog(): Promise<void> {
    // One replica reports, so an alert counts incidents rather than instances.
    await this.lock.runWithLock('backlog-monitor', 60_000, () => this.report());
  }

  private async report(): Promise<void> {
    let report;
    try {
      report = await this.backlog.report();
    } catch (error: any) {
      this.logger.warn(`Could not read the backlog: ${error.message}`);
      return;
    }

    const { outbox, webhooks } = report;

    if (report.stalled) {
      this.logger.error(
        `Work is not moving — outbox: ${outbox.pending} pending (oldest ${describe(outbox.oldestPendingSeconds)}), ` +
          `${outbox.failed} failed; webhooks: ${webhooks.pending} pending (oldest ${describe(webhooks.oldestPendingSeconds)}), ` +
          `${webhooks.failed} failed`,
      );
      return;
    }

    if (outbox.failed > 0 || webhooks.failed > 0) {
      this.logger.warn(
        `Given up on ${outbox.failed} outbox event(s) and ${webhooks.failed} webhook(s) — they need a person`,
      );
    }
  }
}

function describe(seconds: number | null): string {
  if (seconds === null) return 'none';
  if (seconds < 120) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}
