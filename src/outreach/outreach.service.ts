import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/services/prisma.service';
import {
  NotificationsService,
  NotificationCategory,
} from '../notifications/notifications.service';
import { UserContactService } from '../notifications/user-contact.service';
import { FunnelService } from '../funnel/funnel.service';
import {
  renderTemplate,
  TemplateLocale,
  TemplateParams,
} from '../notifications/templates';
import {
  OutreachGeneratorService,
  OutreachContext,
} from './outreach-generator.service';

const OUTCOME_WINDOW_DAYS = 14;

@Injectable()
export class OutreachService {
  private readonly logger = new Logger(OutreachService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly userContactService: UserContactService,
    private readonly funnelService: FunnelService,
    private readonly generator: OutreachGeneratorService,
    @InjectQueue('outreach') private readonly outreachQueue: Queue,
  ) {}

  get enabled(): boolean {
    return this.config.get('OUTREACH_ENABLED') === 'true';
  }

  get maxPerUser7d(): number {
    const parsed = Number(this.config.get('OUTREACH_MAX_PER_USER_7D'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
  }

  private frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') || 'https://billing.inite.ai'
    ).replace(/\/$/, '');
  }

  /**
   * Create the OutreachMessage row (idempotent via unique triggerKey) and
   * enqueue processing. Safe across cron re-runs and multiple instances.
   */
  async enqueue(input: {
    trigger: string;
    triggerKey: string;
    userId: string;
    step?: number;
    funnelEventId?: string;
    orderId?: string;
    subscriptionId?: string;
  }): Promise<boolean> {
    let outreachId: string;
    try {
      const row = await this.prisma.outreachMessage.create({
        data: {
          userId: input.userId,
          trigger: input.trigger,
          step: input.step ?? 0,
          triggerKey: input.triggerKey,
          funnelEventId: input.funnelEventId ?? null,
          orderId: input.orderId ?? null,
          subscriptionId: input.subscriptionId ?? null,
          locale: 'en', // resolved from contact at processing time
          status: 'pending',
        },
      });
      outreachId = row.id;
    } catch (error: any) {
      if (error?.code === 'P2002') return false; // already enqueued — idempotent
      throw error;
    }

    await this.outreachQueue.add(
      'process',
      { outreachId },
      { jobId: input.triggerKey },
    );
    return true;
  }

  /** Full trigger → generate → send pipeline (called by the queue processor). */
  async processOne(outreachId: string): Promise<void> {
    const outreach = await this.prisma.outreachMessage.findUnique({
      where: { id: outreachId },
    });
    if (!outreach || outreach.status !== 'pending') return;

    // Kill switch re-check (scheduler also checks; env can change between)
    if (!this.enabled) {
      await this.skip(outreachId, 'kill_switch');
      return;
    }

    // Re-validate the trigger is still unresolved
    const stillRelevant = await this.isStillRelevant(outreach);
    if (!stillRelevant) {
      await this.skip(outreachId, 'resolved');
      return;
    }

    const contact = await this.userContactService.getContact(outreach.userId);
    const locale: TemplateLocale =
      contact?.locale === 'ru'
        ? 'ru'
        : contact?.locale === 'en'
          ? 'en'
          : this.config.get('OUTREACH_DEFAULT_LOCALE') === 'ru'
            ? 'ru'
            : 'en';

    // Rate cap applies to marketing triggers only; dunning is transactional
    if (outreach.trigger !== 'dunning') {
      const recentCount = await this.prisma.outreachMessage.count({
        where: {
          userId: outreach.userId,
          status: 'sent',
          sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      });
      if (recentCount >= this.maxPerUser7d) {
        await this.skip(outreachId, 'rate_capped');
        return;
      }
    }

    const context = await this.gatherContext(outreach, locale);

    // Generate via Claude; fall back to the static template on any failure
    let subject: string;
    let body: string;
    let source: 'llm' | 'template';
    let model: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;

    try {
      const generated = await this.generator.generate(context.llmContext);
      subject = generated.subject;
      body = generated.body.replace(/\{\{cta_url\}\}/g, context.ctaUrl);
      source = 'llm';
      model = generated.model;
      inputTokens = generated.inputTokens ?? null;
      outputTokens = generated.outputTokens ?? null;
    } catch (error: any) {
      this.logger.warn(
        `LLM generation failed for ${outreach.triggerKey}, using template: ${error.message}`,
      );
      const rendered = renderTemplate(
        outreach.trigger,
        locale,
        context.templateParams,
      );
      subject = rendered.subject;
      body = rendered.text;
      source = 'template';
    }

    const notifications = await this.notificationsService.notify({
      userId: outreach.userId,
      type: outreach.trigger as NotificationCategory,
      channels: ['in_app', 'email'],
      title: subject,
      body,
      metadata: {
        outreachId: outreach.id,
        triggerKey: outreach.triggerKey,
        locale,
        ctaUrl: context.ctaUrl,
        ctaLabel: context.templateParams.ctaLabel,
      },
    });

    const inApp = notifications.find((n) => n.channel === 'in_app');
    const email = notifications.find((n) => n.channel === 'email');

    // Keep the /admin/funnel kanban hasFollowUp badge working
    try {
      await this.funnelService.track({
        userId: outreach.userId,
        eventType: 'follow_up_sent',
        stage: 'churned',
        orderId: outreach.orderId ?? undefined,
        properties: { trigger: outreach.trigger, outreachId: outreach.id },
      });
    } catch (error: any) {
      this.logger.warn(`follow_up_sent tracking failed: ${error.message}`);
    }

    await this.prisma.outreachMessage.update({
      where: { id: outreachId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        locale,
        subject,
        body,
        source,
        model,
        inputTokens,
        outputTokens,
        inAppNotificationId: inApp?.id ?? null,
        emailNotificationId: email?.id ?? null,
      },
    });

    this.logger.log(
      JSON.stringify({
        event: 'outreach_sent',
        outreachId,
        trigger: outreach.trigger,
        source,
        locale,
      }),
    );
  }

  private async skip(outreachId: string, reason: string): Promise<void> {
    await this.prisma.outreachMessage.update({
      where: { id: outreachId },
      data: { status: 'skipped', skipReason: reason },
    });
  }

  private async isStillRelevant(outreach: {
    trigger: string;
    orderId: string | null;
    subscriptionId: string | null;
  }): Promise<boolean> {
    switch (outreach.trigger) {
      case 'abandoned_checkout': {
        if (!outreach.orderId) return false;
        const order = await this.prisma.order.findUnique({
          where: { id: outreach.orderId },
        });
        return order?.status === 'created';
      }
      case 'dunning': {
        if (!outreach.subscriptionId) return false;
        const sub = await this.prisma.subscription.findUnique({
          where: { id: outreach.subscriptionId },
        });
        return sub?.status === 'past_due';
      }
      case 'winback': {
        if (!outreach.subscriptionId) return false;
        const sub = await this.prisma.subscription.findUnique({
          where: { id: outreach.subscriptionId },
        });
        return (
          !!sub && sub.cancelAtPeriodEnd && !['ended', 'canceled'].includes(sub.status)
        );
      }
      case 'trial_ending': {
        if (!outreach.subscriptionId) return false;
        const sub = await this.prisma.subscription.findUnique({
          where: { id: outreach.subscriptionId },
        });
        return sub?.status === 'trialing';
      }
      default:
        return false;
    }
  }

  private async gatherContext(
    outreach: {
      trigger: string;
      orderId: string | null;
      subscriptionId: string | null;
      step: number;
    },
    locale: TemplateLocale,
  ): Promise<{
    ctaUrl: string;
    templateParams: TemplateParams;
    llmContext: OutreachContext;
  }> {
    let productName: string | undefined;
    let serviceName: string | undefined;
    let amount: string | undefined;
    let currency: string | undefined;
    let interval: string | undefined;
    let daysOverdue: number | undefined;
    let periodEnd: string | undefined;
    let ctaUrl = `${this.frontendUrl()}/subscriptions`;

    if (outreach.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: outreach.orderId },
        include: {
          price: { include: { product: { include: { service: true } } } },
        },
      });
      if (order) {
        productName = order.price?.product?.name;
        serviceName = order.price?.product?.service?.name;
        amount = order.amount?.toString();
        currency = order.currency;
        ctaUrl = `${this.frontendUrl()}/checkout/${order.id}`;
      }
    }

    if (outreach.subscriptionId) {
      const sub = await this.prisma.subscription.findUnique({
        where: { id: outreach.subscriptionId },
        include: {
          price: { include: { product: { include: { service: true } } } },
        },
      });
      if (sub) {
        productName = productName ?? sub.price?.product?.name;
        serviceName = serviceName ?? sub.price?.product?.service?.name;
        amount = amount ?? sub.price?.amount?.toString();
        currency = currency ?? sub.price?.currency;
        interval = sub.price?.interval ?? undefined;
        periodEnd = sub.currentPeriodEnd.toISOString().slice(0, 10);
        if (outreach.trigger === 'dunning') {
          daysOverdue = Math.max(
            0,
            Math.floor(
              (Date.now() - sub.currentPeriodEnd.getTime()) / 86_400_000,
            ),
          );
        }
      }
    }

    const ctaLabels: Record<string, Record<TemplateLocale, string>> = {
      abandoned_checkout: { en: 'Complete payment', ru: 'Завершить оплату' },
      dunning: { en: 'Update payment', ru: 'Обновить оплату' },
      winback: { en: 'Resume subscription', ru: 'Возобновить подписку' },
      trial_ending: { en: 'Manage subscription', ru: 'Управлять подпиской' },
    };
    const ctaLabel = ctaLabels[outreach.trigger]?.[locale];

    const templateParams: TemplateParams = {
      productName,
      serviceName,
      amount,
      currency,
      daysOverdue,
      periodEnd,
      ctaUrl,
      ctaLabel,
    };

    const llmContext: OutreachContext = {
      trigger: outreach.trigger,
      locale,
      productName,
      serviceName,
      amount,
      currency,
      interval,
      daysOverdue,
      periodEnd,
      ctaLabel,
    };

    return { ctaUrl, templateParams, llmContext };
  }

  /** Hourly conversion/outcome attribution for sent outreach. */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepOutcomes(): Promise<number> {
    const candidates = await this.prisma.outreachMessage.findMany({
      where: {
        status: 'sent',
        outcome: null,
        sentAt: {
          gte: new Date(Date.now() - OUTCOME_WINDOW_DAYS * 86_400_000),
        },
      },
      take: 500,
    });

    let updated = 0;
    for (const outreach of candidates) {
      const outcome = await this.resolveOutcome(outreach);
      if (outcome) {
        await this.prisma.outreachMessage.update({
          where: { id: outreach.id },
          data: {
            outcome,
            ...(outcome === 'converted' || outcome === 'resolved'
              ? { convertedAt: new Date() }
              : {}),
          },
        });
        updated++;
      }
    }

    // Anything older than the window without an outcome is closed as 'none'
    const expired = await this.prisma.outreachMessage.updateMany({
      where: {
        status: 'sent',
        outcome: null,
        sentAt: {
          lt: new Date(Date.now() - OUTCOME_WINDOW_DAYS * 86_400_000),
        },
      },
      data: { outcome: 'none' },
    });

    if (updated > 0 || expired.count > 0) {
      this.logger.log(
        `Outcome sweep: ${updated} attributed, ${expired.count} closed as none`,
      );
    }
    return updated;
  }

  private async resolveOutcome(outreach: {
    trigger: string;
    orderId: string | null;
    subscriptionId: string | null;
  }): Promise<string | null> {
    switch (outreach.trigger) {
      case 'abandoned_checkout': {
        if (!outreach.orderId) return 'none';
        const order = await this.prisma.order.findUnique({
          where: { id: outreach.orderId },
        });
        if (!order) return 'none';
        if (['paid'].includes(order.status)) return 'converted';
        if (['failed', 'expired'].includes(order.status)) return 'churned';
        return null;
      }
      case 'dunning': {
        if (!outreach.subscriptionId) return 'none';
        const sub = await this.prisma.subscription.findUnique({
          where: { id: outreach.subscriptionId },
        });
        if (!sub) return 'none';
        if (sub.status === 'active') return 'resolved';
        if (['ended', 'canceled'].includes(sub.status)) return 'churned';
        return null;
      }
      case 'winback': {
        if (!outreach.subscriptionId) return 'none';
        const sub = await this.prisma.subscription.findUnique({
          where: { id: outreach.subscriptionId },
        });
        if (!sub) return 'none';
        if (!sub.cancelAtPeriodEnd && ['active', 'trialing'].includes(sub.status)) {
          return 'converted';
        }
        if (['ended', 'canceled'].includes(sub.status)) return 'churned';
        return null;
      }
      case 'trial_ending': {
        if (!outreach.subscriptionId) return 'none';
        const sub = await this.prisma.subscription.findUnique({
          where: { id: outreach.subscriptionId },
        });
        if (!sub) return 'none';
        if (sub.status === 'active') return 'converted';
        if (['ended', 'canceled'].includes(sub.status)) return 'churned';
        return null;
      }
      default:
        return 'none';
    }
  }
}
