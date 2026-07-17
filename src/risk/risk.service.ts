import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/services/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../outbox/outbox.service';

interface RiskSignal {
  code: string;
  weight: number;
  detail: string;
}

export interface RiskResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  status: 'none' | 'flagged' | 'blocked';
  signals: RiskSignal[];
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly outboxService: OutboxService,
  ) {}

  private num(key: string, fallback: number): number {
    const parsed = Number(this.config.get(key));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  get blockingEnabled(): boolean {
    return this.config.get('RISK_BLOCKING_ENABLED') === 'true';
  }

  /**
   * Heuristic risk assessment at checkout-session creation.
   * Monitor-only by default (RISK_BLOCKING_ENABLED=false): assessments are
   * recorded and flagged, but never block an order.
   */
  async assessCheckout(
    order: { id: string; userId: string; amount: any; currency: string },
    context: { ip?: string },
  ): Promise<RiskResult> {
    const signals: RiskSignal[] = [];
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // velocity_orders_user
    const maxOrdersPerHour = this.num('RISK_MAX_ORDERS_PER_HOUR', 5);
    const recentOrders = await this.prisma.order.count({
      where: { userId: order.userId, createdAt: { gte: hourAgo } },
    });
    if (recentOrders > maxOrdersPerHour) {
      signals.push({
        code: 'velocity_orders_user',
        weight: 25,
        detail: `${recentOrders} orders in the last hour (max ${maxOrdersPerHour})`,
      });
    }

    // velocity_orders_ip — queried from prior assessments (that's why ip is stored)
    if (context.ip) {
      const ipAssessments = await this.prisma.riskAssessment.count({
        where: { ip: context.ip, createdAt: { gte: hourAgo } },
      });
      if (ipAssessments > 8) {
        signals.push({
          code: 'velocity_orders_ip',
          weight: 25,
          detail: `${ipAssessments} checkouts from IP in the last hour`,
        });
      }
    }

    // failed_payment_burst
    const failedIntents = await this.prisma.paymentIntent.count({
      where: {
        order: { userId: order.userId },
        status: 'failed',
        createdAt: { gte: dayAgo },
      },
    });
    if (failedIntents > 3) {
      signals.push({
        code: 'failed_payment_burst',
        weight: 30,
        detail: `${failedIntents} failed payment intents in 24h`,
      });
    }

    // amount_outlier — vs the user's own paid-order history, or absolute cap
    const amount = Number(order.amount);
    const absCap = this.num('RISK_ABS_AMOUNT_CAP', 10000);
    const stats = await this.prisma.$queryRaw<
      Array<{ cnt: bigint; avg: number | null; stddev: number | null }>
    >(Prisma.sql`
      SELECT COUNT(*)::bigint AS cnt, AVG(amount)::float AS avg, STDDEV(amount)::float AS stddev
      FROM billing.orders
      WHERE user_id = ${order.userId} AND status = 'paid'
    `);
    const history = stats[0];
    if (
      history &&
      Number(history.cnt) >= 3 &&
      history.avg != null &&
      history.stddev != null &&
      amount > history.avg + 3 * history.stddev
    ) {
      signals.push({
        code: 'amount_outlier',
        weight: 20,
        detail: `${amount} vs user mean ${history.avg.toFixed(2)} (+3σ)`,
      });
    } else if (amount > absCap) {
      signals.push({
        code: 'amount_outlier',
        weight: 20,
        detail: `${amount} exceeds absolute cap ${absCap}`,
      });
    }

    // new_user_high_value
    const newUserThreshold = this.num('RISK_NEW_USER_AMOUNT', 500);
    if (history && Number(history.cnt) === 0 && amount > newUserThreshold) {
      signals.push({
        code: 'new_user_high_value',
        weight: 15,
        detail: `First order of ${amount} (> ${newUserThreshold})`,
      });
    }

    const score = Math.min(
      100,
      signals.reduce((sum, s) => sum + s.weight, 0),
    );
    const level: RiskResult['level'] = score < 30 ? 'low' : score < 60 ? 'medium' : 'high';

    const flagThreshold = this.num('RISK_FLAG_THRESHOLD', 60);
    const blockThreshold = this.num('RISK_BLOCK_THRESHOLD', 85);
    let status: RiskResult['status'] =
      score >= blockThreshold && this.blockingEnabled
        ? 'blocked'
        : score >= flagThreshold
          ? 'flagged'
          : 'none';

    // A recent reviewed_ok suppresses repeat false positives for 24h
    if (status !== 'none') {
      const recentOk = await this.prisma.riskAssessment.findFirst({
        where: {
          userId: order.userId,
          status: 'reviewed_ok',
          reviewedAt: { gte: dayAgo },
        },
      });
      if (recentOk) status = 'none';
    }

    await this.prisma.riskAssessment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        userId: order.userId,
        ip: context.ip ?? null,
        score,
        level,
        signals: signals as unknown as Prisma.InputJsonValue,
        status,
      },
      update: {
        score,
        level,
        signals: signals as unknown as Prisma.InputJsonValue,
        status,
        ip: context.ip ?? null,
      },
    });

    if (status !== 'none') {
      this.notifyAdmins(order.id, score, status);
    }

    return { score, level, status, signals };
  }

  /** Re-evaluate the failed-burst signal after a payment failure. */
  async recordPaymentFailure(orderId: string): Promise<void> {
    const assessment = await this.prisma.riskAssessment.findUnique({
      where: { orderId },
    });
    if (!assessment) return;

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failedIntents = await this.prisma.paymentIntent.count({
      where: {
        order: { userId: assessment.userId },
        status: 'failed',
        createdAt: { gte: dayAgo },
      },
    });
    if (failedIntents <= 3) return;

    const signals = [
      ...((assessment.signals as unknown as RiskSignal[]) ?? []).filter(
        (s) => s.code !== 'failed_payment_burst',
      ),
      {
        code: 'failed_payment_burst',
        weight: 30,
        detail: `${failedIntents} failed payment intents in 24h`,
      },
    ];
    const score = Math.min(
      100,
      signals.reduce((sum, s) => sum + s.weight, 0),
    );
    const flagThreshold = this.num('RISK_FLAG_THRESHOLD', 60);

    await this.prisma.riskAssessment.update({
      where: { orderId },
      data: {
        signals: signals as unknown as Prisma.InputJsonValue,
        score,
        level: score < 30 ? 'low' : score < 60 ? 'medium' : 'high',
        ...(assessment.status === 'none' && score >= flagThreshold ? { status: 'flagged' } : {}),
      },
    });
  }

  /** A paid order on a flagged assessment stays flagged for post-payment review. */
  async recordPaidWhileFlagged(orderId: string): Promise<void> {
    const assessment = await this.prisma.riskAssessment.findUnique({
      where: { orderId },
    });
    if (!assessment || assessment.status !== 'flagged') return;
    const signals = [
      ...((assessment.signals as unknown as RiskSignal[]) ?? []),
      {
        code: 'paid_while_flagged',
        weight: 0,
        detail: 'Order was paid while the assessment was flagged',
      },
    ];
    await this.prisma.riskAssessment.update({
      where: { orderId },
      data: { signals: signals as unknown as Prisma.InputJsonValue },
    });
  }

  private notifyAdmins(orderId: string, score: number, status: string): void {
    void this.outboxService
      .emit(
        'billing.risk.flagged',
        { orderId, score, status },
        { type: 'risk_assessment', id: orderId },
      )
      .catch((error: any) => this.logger.warn(`Risk outbox emit failed: ${error.message}`));
  }
}
