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
   * Get pipeline data for admin kanban view.
   * Groups users by their latest funnel stage.
   */
  async getPipelineData(serviceId?: string): Promise<{
    stages: Array<{
      stage: string;
      items: Array<{
        id: string;
        userId: string;
        orderId?: string;
        productName?: string;
        serviceName?: string;
        amount?: number;
        currency?: string;
        eventType: string;
        stage: string;
        createdAt: string;
        properties?: any;
        hasFollowUp?: boolean;
      }>;
    }>;
    stats: {
      total: number;
      conversionRate: number;
      abandonedCount: number;
      activeSubscriptions: number;
      churningCount: number;
      totalValue: number;
    };
  }> {
    const pipelineStages = [
      'checkout',
      'payment',
      'conversion',
      'retention',
      'churning',
      'churned',
    ];

    const where: any = {};
    if (serviceId) where.serviceId = serviceId;

    // Get all funnel events, ordered by user + time
    const allEvents = await this.prisma.funnelEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // For each user, find their LATEST event to determine current stage
    const userLatestMap = new Map<
      string,
      (typeof allEvents)[0]
    >();
    const userFollowUpMap = new Map<string, boolean>();

    for (const event of allEvents) {
      if (event.eventType === 'follow_up_sent') {
        userFollowUpMap.set(event.userId, true);
      }
      if (!userLatestMap.has(event.userId)) {
        userLatestMap.set(event.userId, event);
      }
    }

    // Map legacy stage names to pipeline stages
    const stageMapping: Record<string, string> = {
      awareness: 'checkout',
      checkout: 'checkout',
      payment: 'payment',
      conversion: 'conversion',
      retention: 'retention',
      churning: 'churning',
      churned: 'churned',
    };

    // Also map event types to determine more specific stages
    const eventToStage: Record<string, string> = {
      checkout_started: 'checkout',
      payment_pending: 'payment',
      payment_completed: 'conversion',
      subscription_created: 'retention',
      subscription_renewed: 'retention',
      subscription_churning: 'churning',
      subscription_canceled: 'churned',
      checkout_abandoned: 'churned',
      subscription_churned: 'churned',
    };

    // Group users by their current stage
    const stageGroups = new Map<string, Array<typeof allEvents[0] & { hasFollowUp?: boolean }>>();
    for (const stage of pipelineStages) {
      stageGroups.set(stage, []);
    }

    for (const [userId, event] of userLatestMap.entries()) {
      const resolvedStage =
        eventToStage[event.eventType] ||
        stageMapping[event.stage] ||
        'checkout';
      const group = stageGroups.get(resolvedStage) || stageGroups.get('checkout')!;
      group.push({
        ...event,
        hasFollowUp: userFollowUpMap.get(userId) || false,
      });
    }

    // Enrich items with order/product data
    const enrichedStages = await Promise.all(
      pipelineStages.map(async (stage) => {
        const items = stageGroups.get(stage) || [];
        const enrichedItems = await Promise.all(
          items.slice(0, 50).map(async (event) => {
            let productName: string | undefined;
            let serviceName: string | undefined;
            let amount: number | undefined = event.amount
              ? Number(event.amount)
              : undefined;
            let currency: string | undefined = event.currency ?? undefined;

            if (event.orderId) {
              try {
                const order = await this.prisma.order.findUnique({
                  where: { id: event.orderId },
                  include: {
                    price: {
                      include: {
                        product: {
                          include: { service: true },
                        },
                      },
                    },
                  },
                });
                if (order) {
                  productName = order.price?.product?.name;
                  serviceName = order.price?.product?.service?.name;
                  if (!amount) amount = Number(order.amount);
                  if (!currency) currency = order.currency;
                }
              } catch {
                // ignore lookup failures
              }
            } else if (event.productId) {
              try {
                const product = await this.prisma.product.findUnique({
                  where: { id: event.productId },
                  include: { service: true },
                });
                if (product) {
                  productName = product.name;
                  serviceName = product.service?.name;
                }
              } catch {
                // ignore
              }
            }

            return {
              id: event.id,
              userId: event.userId,
              orderId: event.orderId ?? undefined,
              productName,
              serviceName,
              amount,
              currency,
              eventType: event.eventType,
              stage,
              createdAt: event.createdAt.toISOString(),
              properties: event.properties ?? undefined,
              hasFollowUp: (event as any).hasFollowUp || false,
            };
          }),
        );
        return { stage, items: enrichedItems };
      }),
    );

    // Calculate stats
    const total = userLatestMap.size;
    const checkoutCount = allEvents.filter(
      (e) => e.eventType === 'checkout_started',
    ).length;
    const paidCount = allEvents.filter(
      (e) => e.eventType === 'payment_completed',
    ).length;
    const conversionRate =
      checkoutCount > 0
        ? Math.round((paidCount / checkoutCount) * 100 * 100) / 100
        : 0;
    const abandonedCount = (stageGroups.get('churned') || []).length;
    const activeSubscriptions = (stageGroups.get('retention') || []).length;
    const churningCount = (stageGroups.get('churning') || []).length;
    const totalValue = Array.from(userLatestMap.values()).reduce(
      (sum, e) => sum + (e.amount ? Number(e.amount) : 0),
      0,
    );

    return {
      stages: enrichedStages,
      stats: {
        total,
        conversionRate,
        abandonedCount,
        activeSubscriptions,
        churningCount,
        totalValue: Math.round(totalValue * 100) / 100,
      },
    };
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
