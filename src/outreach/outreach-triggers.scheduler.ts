import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/services/prisma.service';
import { OutreachService } from './outreach.service';

const DUNNING_STEPS = [0, 2, 5];
const DEFAULT_TRIGGERS = 'abandoned_checkout,dunning,winback,trial_ending';

@Injectable()
export class OutreachTriggersScheduler {
  private readonly logger = new Logger(OutreachTriggersScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly outreachService: OutreachService,
  ) {}

  private enabledTriggers(): Set<string> {
    return new Set(
      (this.config.get<string>('OUTREACH_TRIGGERS') || DEFAULT_TRIGGERS)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    );
  }

  // Offset +5 min so it runs after the funnel detection cron (0 */15)
  @Cron('0 5,20,35,50 * * * *')
  async run(): Promise<void> {
    if (!this.outreachService.enabled) return;
    const triggers = this.enabledTriggers();

    try {
      if (triggers.has('abandoned_checkout')) await this.abandonedCheckouts();
      if (triggers.has('dunning')) await this.dunning();
      if (triggers.has('winback')) await this.winback();
      if (triggers.has('trial_ending')) await this.trialEnding();
    } catch (error: any) {
      this.logger.error(`Outreach trigger sweep failed: ${error.message}`);
    }
  }

  private async abandonedCheckouts(): Promise<void> {
    const events = await this.prisma.funnelEvent.findMany({
      where: {
        eventType: 'checkout_abandoned',
        createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    for (const event of events) {
      if (!event.orderId) continue;
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
      });
      if (order?.status !== 'created') continue;
      await this.outreachService.enqueue({
        trigger: 'abandoned_checkout',
        triggerKey: `abandoned_checkout:${event.orderId}`,
        userId: event.userId,
        funnelEventId: event.id,
        orderId: event.orderId,
      });
    }
  }

  private async dunning(): Promise<void> {
    const pastDue = await this.prisma.subscription.findMany({
      where: { status: 'past_due' },
      take: 500,
    });

    for (const sub of pastDue) {
      const daysOverdue = Math.floor(
        (Date.now() - sub.currentPeriodEnd.getTime()) / 86_400_000,
      );
      for (const step of DUNNING_STEPS) {
        if (daysOverdue < step) continue;
        await this.outreachService.enqueue({
          trigger: 'dunning',
          triggerKey: `dunning:${sub.id}:${sub.currentPeriodEnd.toISOString()}:d${step}`,
          userId: sub.userId,
          step,
          subscriptionId: sub.id,
        });
      }
    }
  }

  private async winback(): Promise<void> {
    const events = await this.prisma.funnelEvent.findMany({
      where: {
        eventType: 'subscription_churning',
        createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    for (const event of events) {
      const subscriptionId = (event.properties as any)?.subscriptionId as
        | string
        | undefined;
      if (!subscriptionId) continue;
      const sub = await this.prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });
      if (!sub || !sub.cancelAtPeriodEnd) continue; // cancellation reverted
      if (['ended', 'canceled'].includes(sub.status)) continue;
      await this.outreachService.enqueue({
        trigger: 'winback',
        triggerKey: `winback:${sub.id}:${sub.currentPeriodEnd.toISOString()}`,
        userId: sub.userId,
        funnelEventId: event.id,
        subscriptionId: sub.id,
      });
    }
  }

  private async trialEnding(): Promise<void> {
    const trials = await this.prisma.subscription.findMany({
      where: {
        status: 'trialing',
        currentPeriodEnd: {
          gt: new Date(),
          lte: new Date(Date.now() + 3 * 86_400_000),
        },
      },
      take: 500,
    });

    for (const sub of trials) {
      await this.outreachService.enqueue({
        trigger: 'trial_ending',
        triggerKey: `trial_ending:${sub.id}:${sub.currentPeriodEnd.toISOString()}`,
        userId: sub.userId,
        subscriptionId: sub.id,
      });
    }
  }
}
