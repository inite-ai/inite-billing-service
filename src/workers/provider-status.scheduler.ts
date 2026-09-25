import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/services/prisma.service';
import { DistributedLockService } from '../common/locks/distributed-lock.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { Connector } from '../common/connectors/connector.interface';

/** How long an unpaid redirect payment is watched before it is given up on. */
const ABANDON_AFTER_MS = 72 * 60 * 60 * 1000;
/** Subscriptions are checked from this long before their period ends. */
const RENEWAL_WINDOW_MS = 60 * 60 * 1000;
const MAX_INTENTS_PER_RUN = 100;
const MAX_SUBSCRIPTIONS_PER_RUN = 50;

/**
 * How often an open payment is asked about, by its age: every minute while
 * the customer is likely still paying, then less and less. A payment is
 * almost always settled within minutes; the long tail is for bank delays.
 */
function pollEveryMs(ageMs: number): number {
  if (ageMs < 30 * 60 * 1000) return 60 * 1000;
  if (ageMs < 6 * 60 * 60 * 1000) return 5 * 60 * 1000;
  return 30 * 60 * 1000;
}

export interface ProviderPollReport {
  checked: number;
  settled: number;
  expired: number;
  subscriptionEvents: number;
}

/**
 * Settles payments on rails whose webhooks are optional (lava.top) by asking
 * the provider, so a payment goes through even with no webhook configured.
 *
 * Every minute it takes the open payments on rails that declare
 * `statusPolling`, and asks about each at a pace set by its age. It applies
 * what it learns through the orchestrator's own sync — same reconciliation,
 * same state machine as a webhook — so a webhook and a poll arriving together
 * cannot both apply. A payment still unpaid after three days is expired.
 *
 * Subscriptions on those rails are checked as their period ends: renewed,
 * failed or cancelled on the provider's side becomes the same lifecycle event
 * a webhook would have delivered.
 */
@Injectable()
export class ProviderStatusScheduler {
  private readonly logger = new Logger(ProviderStatusScheduler.name);
  private readonly lastChecked = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: PaymentOrchestratorService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    await this.lock.runWithLock('provider-status-poll', 5 * 60_000, async () => {
      await this.poll();
    });
  }

  /** Active rails whose connectors ask to be polled. */
  private async pollingRails(): Promise<Map<string, Connector>> {
    const providers = await this.prisma.paymentProvider.findMany({
      where: { isActive: true },
      select: { code: true },
    });
    const rails = new Map<string, Connector>();
    for (const { code } of providers) {
      try {
        const connector = this.orchestrator.getAdapter(code) as Connector;
        if (connector.capabilities?.().statusPolling) rails.set(code, connector);
      } catch {
        // No connector for this provider code; nothing to poll.
      }
    }
    return rails;
  }

  private due(key: string, everyMs: number, now: number): boolean {
    const last = this.lastChecked.get(key);
    if (last !== undefined && now - last < everyMs) return false;
    this.lastChecked.set(key, now);
    return true;
  }

  async poll(nowDate = new Date()): Promise<ProviderPollReport> {
    const report: ProviderPollReport = {
      checked: 0,
      settled: 0,
      expired: 0,
      subscriptionEvents: 0,
    };
    const rails = await this.pollingRails();
    if (rails.size === 0) return report;
    const now = nowDate.getTime();

    const intents = await this.prisma.paymentIntent.findMany({
      where: {
        rail: { in: [...rails.keys()] },
        status: { in: ['created', 'opened'] },
        providerIntentId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_INTENTS_PER_RUN,
      select: { id: true, status: true, createdAt: true },
    });

    for (const intent of intents) {
      const age = now - intent.createdAt.getTime();
      const abandoned = age > ABANDON_AFTER_MS;
      if (!abandoned && !this.due(intent.id, pollEveryMs(age), now)) continue;
      report.checked++;
      try {
        const result = await this.orchestrator.syncIntentWithProvider(intent.id);
        if (result.changed) {
          report.settled++;
          this.lastChecked.delete(intent.id);
          continue;
        }
        if (abandoned) {
          // Asked one last time and still not paid: give it up, which ends the
          // order and returns any promo code it held.
          await this.orchestrator.applyStateTransition(intent.id, 'expired');
          this.lastChecked.delete(intent.id);
          report.expired++;
        }
      } catch (error: any) {
        this.logger.warn(
          `Could not check payment ${intent.id} with its provider: ${error.message}`,
        );
      }
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        rail: { in: [...rails.keys()] },
        status: { in: ['active', 'trialing', 'past_due'] },
        providerSubscriptionId: { not: null },
        currentPeriodEnd: { lte: new Date(now + RENEWAL_WINDOW_MS) },
      },
      take: MAX_SUBSCRIPTIONS_PER_RUN,
      select: {
        id: true,
        rail: true,
        providerSubscriptionId: true,
        currentPeriodEnd: true,
        status: true,
      },
    });

    for (const sub of subscriptions) {
      const connector = rails.get(sub.rail as string);
      if (!connector?.syncSubscription || !sub.providerSubscriptionId || !sub.currentPeriodEnd)
        continue;
      if (!this.due(`sub:${sub.id}`, 30 * 60 * 1000, now)) continue;
      try {
        const event = await connector.syncSubscription({
          providerSubscriptionId: sub.providerSubscriptionId,
          currentPeriodEnd: sub.currentPeriodEnd,
          status: sub.status,
        });
        if (!event) continue;
        // No provider charge id: the renewal's idempotency key then derives
        // from the period, which is also what the webhook for the same renewal
        // maps to — so a poll and a late webhook cannot both renew.
        await this.orchestrator.handleSubscriptionEvent(
          sub.rail as string,
          event,
          sub.providerSubscriptionId,
          {
            source: 'provider-poll',
          },
        );
        this.lastChecked.delete(`sub:${sub.id}`);
        report.subscriptionEvents++;
      } catch (error: any) {
        this.logger.warn(
          `Could not check subscription ${sub.id} with its provider: ${error.message}`,
        );
      }
    }

    if (report.settled || report.expired || report.subscriptionEvents) {
      this.logger.log(
        `Provider poll: ${report.settled} settled, ${report.expired} expired, ${report.subscriptionEvents} subscription events`,
      );
    }
    return report;
  }
}
