import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/services/prisma.service';

@Injectable()
export class FunnelService {
  private readonly logger = new Logger(FunnelService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Track a funnel event
   */
  async track(data: {
    userId: string;
    eventType: string;
    stage: string;
    sessionId?: string;
    orderId?: string;
    productId?: string;
    serviceId?: string;
    amount?: number;
    currency?: string;
    properties?: Record<string, any>;
  }): Promise<void> {
    try {
      await this.prisma.funnelEvent.create({
        data: {
          userId: data.userId,
          eventType: data.eventType,
          stage: data.stage,
          sessionId: data.sessionId,
          orderId: data.orderId,
          productId: data.productId,
          serviceId: data.serviceId,
          amount: data.amount,
          currency: data.currency,
          properties: data.properties ?? {},
        },
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to track funnel event ${data.eventType}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Process all automated funnel actions.
   * Runs every 15 minutes.
   */
  @Cron('0 */15 * * * *')
  async processAutomatedActions(): Promise<void> {
    await this.detectAbandonedCheckouts();
    await this.processFollowUpRules();
    await this.detectChurningSubscriptions();
  }

  /**
   * Detect abandoned checkouts (orders created >1hr ago, still in 'created' status).
   */
  async detectAbandonedCheckouts(): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Find orders with status='created' older than 1 hour
    const staleOrders = await this.prisma.order.findMany({
      where: {
        status: 'created',
        createdAt: { lt: oneHourAgo },
      },
      include: {
        price: { include: { product: true } },
      },
    });

    let count = 0;

    for (const order of staleOrders) {
      // Check if checkout_abandoned event already exists for this order
      const existing = await this.prisma.funnelEvent.findFirst({
        where: {
          orderId: order.id,
          eventType: 'checkout_abandoned',
        },
      });

      if (existing) continue;

      await this.track({
        userId: order.userId,
        eventType: 'checkout_abandoned',
        stage: 'churned',
        orderId: order.id,
        productId: order.price?.product?.id,
        serviceId: order.price?.product?.serviceId ?? undefined,
        amount: Number(order.amount),
        currency: order.currency,
        properties: { detectedAt: new Date().toISOString() },
      });

      count++;
    }

    if (count > 0) {
      this.logger.log(`Detected ${count} abandoned checkouts`);
    }

    return count;
  }

  /**
   * Process follow-up rules for abandoned checkouts.
   * Finds checkout_abandoned events from last 24h that haven't been followed up.
   */
  async processFollowUpRules(): Promise<number> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const abandonedEvents = await this.prisma.funnelEvent.findMany({
      where: {
        eventType: 'checkout_abandoned',
        createdAt: { gte: twentyFourHoursAgo },
      },
    });

    let count = 0;

    for (const event of abandonedEvents) {
      // Check if follow_up_sent already exists for this order
      const existing = await this.prisma.funnelEvent.findFirst({
        where: {
          orderId: event.orderId,
          eventType: 'follow_up_sent',
        },
      });

      if (existing) continue;

      await this.track({
        userId: event.userId,
        eventType: 'follow_up_sent',
        stage: 'churned',
        orderId: event.orderId ?? undefined,
        productId: event.productId ?? undefined,
        serviceId: event.serviceId ?? undefined,
        properties: {
          triggeredBy: 'automated_rule',
          abandonedAt: event.createdAt.toISOString(),
          followUpAt: new Date().toISOString(),
        },
      });

      count++;
    }

    if (count > 0) {
      this.logger.log(`Sent ${count} follow-up actions for abandoned checkouts`);
    }

    return count;
  }

  /**
   * Detect churning subscriptions.
   * Finds subscriptions where currentPeriodEnd is within 3 days and cancelAtPeriodEnd=true.
   */
  async detectChurningSubscriptions(): Promise<number> {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const churningSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: { lte: threeDaysFromNow },
      },
      include: {
        price: { include: { product: true } },
      },
    });

    let count = 0;

    for (const sub of churningSubscriptions) {
      // Check if subscription_churning event already exists
      const existing = await this.prisma.funnelEvent.findFirst({
        where: {
          userId: sub.userId,
          eventType: 'subscription_churning',
          properties: {
            path: ['subscriptionId'],
            equals: sub.id,
          },
        },
      });

      if (existing) continue;

      await this.track({
        userId: sub.userId,
        eventType: 'subscription_churning',
        stage: 'churned',
        productId: sub.price?.product?.id,
        serviceId: sub.price?.product?.serviceId ?? undefined,
        properties: {
          subscriptionId: sub.id,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString(),
          detectedAt: new Date().toISOString(),
        },
      });

      count++;
    }

    if (count > 0) {
      this.logger.log(`Detected ${count} churning subscriptions`);
    }

    return count;
  }

  /**
   * Get funnel metrics for admin dashboard
   */
  async getFunnelMetrics(params: {
    serviceId?: string;
    from?: Date;
    to?: Date;
  }): Promise<{
    stages: Array<{
      stage: string;
      count: number;
      conversionRate: number;
    }>;
    totalEvents: number;
    abandonedCheckouts: number;
    conversionRate: number;
  }> {
    const where: any = {};
    if (params.serviceId) where.serviceId = params.serviceId;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = params.from;
      if (params.to) where.createdAt.lte = params.to;
    }

    // Get counts per stage
    const stageOrder = [
      'awareness',
      'checkout',
      'payment',
      'conversion',
      'retention',
      'churned',
    ];

    const stageCounts = await this.prisma.funnelEvent.groupBy({
      by: ['stage'],
      where,
      _count: { id: true },
    });

    const stageMap = new Map(
      stageCounts.map((s) => [s.stage, s._count.id]),
    );

    const stages = stageOrder.map((stage, index) => {
      const count = stageMap.get(stage) || 0;
      const prevCount =
        index > 0 ? stageMap.get(stageOrder[index - 1]) || 0 : 0;
      const conversionRate =
        index === 0 ? 100 : prevCount > 0 ? (count / prevCount) * 100 : 0;
      return { stage, count, conversionRate: Math.round(conversionRate * 100) / 100 };
    });

    const totalEvents = stageCounts.reduce((sum, s) => sum + s._count.id, 0);

    // Get abandoned checkouts count
    const abandonedCheckouts = await this.prisma.funnelEvent.count({
      where: { ...where, eventType: 'checkout_abandoned' },
    });

    // Conversion rate: checkout_started -> payment_completed
    const checkoutStartedCount = await this.prisma.funnelEvent.count({
      where: { ...where, eventType: 'checkout_started' },
    });
    const paymentCompletedCount = await this.prisma.funnelEvent.count({
      where: { ...where, eventType: 'payment_completed' },
    });
    const conversionRate =
      checkoutStartedCount > 0
        ? Math.round(
            (paymentCompletedCount / checkoutStartedCount) * 100 * 100,
          ) / 100
        : 0;

    return { stages, totalEvents, abandonedCheckouts, conversionRate };
  }

  /**
   * Get user journey timeline
   */
  async getUserJourney(userId: string) {
    return this.prisma.funnelEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get funnel breakdown by time period
   */
  async getFunnelTimeSeries(params: {
    serviceId?: string;
    from: Date;
    to: Date;
    granularity: 'day' | 'week' | 'month';
  }): Promise<
    Array<{
      period: string;
      checkoutStarted: number;
      paymentCompleted: number;
      subscriptionCreated: number;
      abandoned: number;
      conversionRate: number;
    }>
  > {
    const truncFn =
      params.granularity === 'day'
        ? 'day'
        : params.granularity === 'week'
          ? 'week'
          : 'month';

    const serviceFilter = params.serviceId
      ? `AND service_id = '${params.serviceId}'::uuid`
      : '';

    const rows: Array<{
      period: Date;
      event_type: string;
      cnt: bigint;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT date_trunc('${truncFn}', created_at) AS period,
              event_type,
              COUNT(*)::bigint AS cnt
       FROM billing.funnel_events
       WHERE created_at >= $1 AND created_at <= $2
       ${serviceFilter}
       GROUP BY period, event_type
       ORDER BY period`,
      params.from,
      params.to,
    );

    // Group by period
    const periodMap = new Map<
      string,
      {
        checkoutStarted: number;
        paymentCompleted: number;
        subscriptionCreated: number;
        abandoned: number;
      }
    >();

    for (const row of rows) {
      const key = row.period.toISOString();
      if (!periodMap.has(key)) {
        periodMap.set(key, {
          checkoutStarted: 0,
          paymentCompleted: 0,
          subscriptionCreated: 0,
          abandoned: 0,
        });
      }
      const entry = periodMap.get(key)!;
      const count = Number(row.cnt);

      if (row.event_type === 'checkout_started') entry.checkoutStarted = count;
      else if (row.event_type === 'payment_completed')
        entry.paymentCompleted = count;
      else if (row.event_type === 'subscription_created')
        entry.subscriptionCreated = count;
      else if (row.event_type === 'checkout_abandoned')
        entry.abandoned = count;
    }

    return Array.from(periodMap.entries()).map(([period, data]) => ({
      period,
      ...data,
      conversionRate:
        data.checkoutStarted > 0
          ? Math.round(
              (data.paymentCompleted / data.checkoutStarted) * 100 * 100,
            ) / 100
          : 0,
    }));
  }

  /**
   * Get abandoned checkout orders with funnel event data (for admin listing)
   */
  async getAbandonedCheckouts(params: { page?: number; limit?: number }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.funnelEvent.findMany({
        where: { eventType: 'checkout_abandoned' },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.funnelEvent.count({
        where: { eventType: 'checkout_abandoned' },
      }),
    ]);

    // Enrich with order data
    const enriched = await Promise.all(
      items.map(async (event) => {
        let order = null;
        if (event.orderId) {
          order = await this.prisma.order.findUnique({
            where: { id: event.orderId },
            include: { price: { include: { product: true } } },
          });
        }
        return {
          ...event,
          order,
          timeSinceCreation: order
            ? Date.now() - new Date(order.createdAt).getTime()
            : null,
        };
      }),
    );

    return {
      items: enriched,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
