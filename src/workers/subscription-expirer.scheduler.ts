import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/services/prisma.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { DistributedLockService } from '../common/locks/distributed-lock.service';

/**
 * Closes the loop on subscriptions whose currentPeriodEnd has passed.
 *
 * Renewals are driven by provider webhooks (handled in WebhookProcessor).
 * This scheduler covers what webhooks can't:
 *   1. PROMO / seeded subs that have no provider — must end after one period.
 *   2. cancelAtPeriodEnd subs — must transition to canceled at period boundary.
 *   3. past_due subs whose grace window has run out — must end + revoke.
 *   4. Provider-backed subs whose renewal webhook never arrived — flagged as
 *      past_due so they enter the grace window instead of silently lingering
 *      with an expired period.
 */
@Injectable()
export class SubscriptionExpirerScheduler {
  private readonly logger = new Logger(SubscriptionExpirerScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: PaymentOrchestratorService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    // One instance at a time — otherwise every replica double-processes the same
    // expired subscriptions (and races renewal webhooks).
    await this.lock.runWithLock('subscription-expirer', 10 * 60_000, () => this.runSweep());
  }

  private async runSweep(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['active', 'trialing', 'past_due'] },
        currentPeriodEnd: { lte: now },
      },
      include: { price: true },
    });

    if (expired.length === 0) return;

    this.logger.log(`Sweeping ${expired.length} expired subscription(s)`);

    for (const sub of expired) {
      try {
        await this.processOne(sub, now);
      } catch (error: any) {
        this.logger.error(`Failed to sweep subscription ${sub.id}: ${error.message}`, error.stack);
      }
    }
  }

  private async processOne(sub: any, now: Date): Promise<void> {
    if (sub.status === 'past_due') {
      const graceDays = sub.price?.graceDays || 0;
      const graceEnd = new Date(sub.currentPeriodEnd.getTime() + graceDays * 24 * 60 * 60 * 1000);
      if (now >= graceEnd) {
        await this.orchestrator.endSubscription(sub.id, 'grace_period_exhausted');
        this.logger.log(`Sub ${sub.id} ended (grace exhausted)`);
      }
      return;
    }

    // active / trialing with period passed
    if (sub.cancelAtPeriodEnd) {
      await this.orchestrator.endSubscription(sub.id, 'cancelled_at_period_end');
      this.logger.log(`Sub ${sub.id} canceled at period end`);
      return;
    }

    if (!sub.providerSubscriptionId) {
      // PROMO / seeded / no-provider — no automatic renewal possible.
      await this.orchestrator.endSubscription(sub.id, 'promo_expired');
      this.logger.log(`Sub ${sub.id} ended (no provider, period elapsed)`);
      return;
    }

    // Provider-backed but renewal webhook hasn't arrived. Move to past_due
    // so the grace window starts ticking; if the renewal does land later,
    // handleSubscriptionEvent will flip it back to active.
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'past_due', updatedAt: now },
    });
    this.logger.warn(
      `Sub ${sub.id} flagged past_due (rail=${sub.rail} providerSubId=${sub.providerSubscriptionId}) — renewal webhook overdue`,
    );
  }
}
