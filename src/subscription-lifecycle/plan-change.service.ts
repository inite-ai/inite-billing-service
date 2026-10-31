import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/services/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { resolveFrontendUrl } from '../common/config/frontend-url';
import { newCheckoutLink } from '../checkout/checkout-link';
import { checkoutPageUrl } from '../checkout/checkout.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { PLAN_CHANGE_KEY } from '../payment-orchestrator/subscription-changes';
import { SessionLinksService } from '../service-api/session-links';
import { decidePlanChange } from './proration';
import {
  ORG_MANAGERS_ONLY,
  SubscriberCaller,
  mayManage,
  visibleSubscribers,
} from '../subscriptions/subscribers';

/** Who asks: the subscriber themselves, or the service that sold the plan. */
/** The subscriber's person (with their token's organisation), or the selling service. */
export type ChangeCaller = SubscriberCaller | { serviceId: string };

export interface ChangePlanInput {
  subscriptionId: string;
  priceCode: string;
  successUrl?: string;
  errorUrl?: string;
  locale?: string;
}

export type ChangePlanResult =
  | { status: 'unchanged'; subscriptionId: string }
  | { status: 'changed'; subscriptionId: string; priceCode: string }
  | { status: 'scheduled'; subscriptionId: string; priceCode: string; effectiveAt: string }
  | {
      status: 'payment_required';
      subscriptionId: string;
      priceCode: string;
      amount: string;
      currency: string;
      sessionId: string;
      checkoutUrl: string;
      x402Url?: string;
    };

const LIVE_INTENT = ['created', 'opened'] as const;

/**
 * POST …/subscriptions/:id/change — one plan for another within one service,
 * by the rules in proration.ts (owner, 30.10.2026).
 *
 * A subscription a provider renews (lava.top, Stripe, the stores) cannot be
 * moved here: the provider would keep charging the old amount. Those are
 * refused with what to do instead (cancel at period end, buy the new plan).
 */
@Injectable()
export class PlanChangeService {
  private readonly logger = new Logger(PlanChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly orchestrator: PaymentOrchestratorService,
    private readonly links: SessionLinksService,
    private readonly config: ConfigService,
  ) {}

  async change(caller: ChangeCaller, input: ChangePlanInput): Promise<ChangePlanResult> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: input.subscriptionId },
      include: { price: { include: { product: { include: { service: true } } } } },
    });
    const serviceId = sub?.price?.product?.serviceId ?? null;
    const mine =
      !!sub &&
      ('userId' in caller
        ? visibleSubscribers(caller).includes(sub.userId)
        : serviceId === caller.serviceId);
    // The same answer for "not yours" and "not there": no probing other ids.
    if (!sub || !mine) throw new NotFoundException('Subscription not found');
    // The organisation's plan, seen by a member: only its owner or admin moves it.
    if ('userId' in caller && !mayManage(caller, sub.userId)) {
      throw new ForbiddenException(ORG_MANAGERS_ONLY);
    }

    if (sub.status === 'past_due') {
      throw new ConflictException('This subscription has an unpaid renewal: pay it first');
    }
    if (sub.status !== 'active' && sub.status !== 'trialing') {
      throw new ConflictException(`This subscription is ${sub.status}`);
    }
    if (sub.cancelAtPeriodEnd) {
      throw new ConflictException('This subscription is cancelled at period end: resume it first');
    }

    const to = await this.prisma.price.findUnique({
      where: { code: input.priceCode },
      include: { product: true },
    });
    if (!to || !to.isActive || !to.product?.isActive || to.product.serviceId !== serviceId) {
      throw new NotFoundException(`Price not found: ${input.priceCode}`);
    }
    if (to.product.type !== 'subscription' || !to.interval) {
      throw new BadRequestException('A plan is changed only to another subscription price');
    }
    if (String(to.currency).toUpperCase() !== String(sub.price.currency).toUpperCase()) {
      throw new BadRequestException(
        `A plan in ${sub.price.currency} changes only to a price in ${sub.price.currency}`,
      );
    }

    // Back to the current plan: a scheduled change is called off.
    if (to.id === sub.priceId) {
      if (sub.pendingPriceId) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { pendingPriceId: null },
        });
        await this.closeRenewalOrder(sub);
        await this.outbox.emit(
          'billing.subscription.plan_change_cancelled',
          { subscription_id: sub.id, user_id: sub.userId },
          { serviceId },
        );
      }
      return { status: 'unchanged', subscriptionId: sub.id };
    }

    if (sub.providerSubscriptionId) {
      throw new ConflictException(
        `This subscription renews through ${sub.rail ?? 'its provider'}, which keeps its own amount: ` +
          'cancel it at period end and subscribe to the new plan',
      );
    }

    const decision = decidePlanChange({
      from: sub.price,
      to,
      status: sub.status,
      unpaidTrial: sub.status === 'trialing' && !sub.rail,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      now: new Date(),
    });

    switch (decision.effect) {
      case 'none':
        return { status: 'unchanged', subscriptionId: sub.id };

      case 'now_free': {
        await this.closeRenewalOrder(sub);
        const applied = await this.orchestrator.changePlanWithoutPayment(sub.id, to);
        if (!applied) throw new ConflictException('This subscription is no longer live');
        return { status: 'changed', subscriptionId: sub.id, priceCode: to.code };
      }

      case 'period_end': {
        await this.closeRenewalOrder(sub);
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { pendingPriceId: to.id },
        });
        const effectiveAt = sub.currentPeriodEnd.toISOString();
        await this.outbox.emit(
          'billing.subscription.plan_change_scheduled',
          {
            subscription_id: sub.id,
            user_id: sub.userId,
            from_price_id: sub.priceId,
            to_price_id: to.id,
            price_code: to.code,
            effective_at: effectiveAt,
          },
          { serviceId },
        );
        return { status: 'scheduled', subscriptionId: sub.id, priceCode: to.code, effectiveAt };
      }

      case 'now_charge': {
        await this.closeRenewalOrder(sub);
        await this.closeOpenPlanChangeOrders(sub.id);
        const portal = `${resolveFrontendUrl(this.config)}/subscriptions?service=${encodeURIComponent(
          sub.price.product.service?.code ?? '',
        )}`;
        const link = newCheckoutLink();
        const order = await this.prisma.order.create({
          data: {
            userId: sub.userId,
            priceId: to.id,
            // A one-off payment to the rail: the difference never recurs.
            mode: 'PAYMENT',
            status: 'created',
            amount: decision.amount,
            currency: to.currency,
            externalId: `plan_change_${sub.id}_${randomUUID()}`,
            snapshot: {
              priceCode: to.code,
              priceAmount: to.amount.toString(),
              currency: to.currency,
              interval: to.interval,
              productCode: to.product.code,
              productName: to.product.name,
              productType: to.product.type,
              serviceId,
              planChangeFrom: sub.price.code,
              proratedAmount: decision.amount.toFixed(2),
              capturedAt: new Date().toISOString(),
            },
            metadata: {
              [PLAN_CHANGE_KEY]: {
                subscriptionId: sub.id,
                fromPriceId: sub.priceId,
                toPriceId: to.id,
                periodEnd: sub.currentPeriodEnd.toISOString(),
              },
              successUrl: input.successUrl || portal,
              errorUrl: input.errorUrl || portal,
              linkTokenHash: link.hash,
            },
          },
        });
        this.logger.log(
          `Upgrade of ${sub.id} to ${to.code}: ${decision.amount.toFixed(2)} ${to.currency} (order ${order.id})`,
        );
        const session = await this.links.withX402({
          sessionId: order.id,
          checkoutUrl: `${checkoutPageUrl(resolveFrontendUrl(this.config), order.id, input.locale)}#t=${link.token}`,
        });
        return {
          status: 'payment_required',
          subscriptionId: sub.id,
          priceCode: to.code,
          amount: decision.amount.toFixed(2),
          currency: to.currency,
          ...session,
        };
      }
    }
  }

  /**
   * The renewal order opened for this period was priced for the old plan.
   * Unpaid and untouched, it is closed and the next sweep opens the right
   * one; with a payment under way, the change waits.
   */
  private async closeRenewalOrder(sub: { id: string; renewalOrderId: string | null }) {
    if (!sub.renewalOrderId) return;
    await this.closeOrder(sub.renewalOrderId, 'A renewal payment is under way: try again after it');
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { renewalOrderId: null },
    });
  }

  /** An earlier upgrade the person never paid: only the newest one may be paid. */
  private async closeOpenPlanChangeOrders(subscriptionId: string) {
    const open = await this.prisma.order.findMany({
      where: {
        status: 'created',
        metadata: { path: [PLAN_CHANGE_KEY, 'subscriptionId'], equals: subscriptionId },
      },
      select: { id: true },
    });
    for (const order of open) {
      await this.closeOrder(order.id, 'An earlier plan change is being paid: try again after it');
    }
  }

  private async closeOrder(orderId: string, busy: string) {
    const live = await this.prisma.paymentIntent.count({
      where: { orderId, status: { in: [...LIVE_INTENT] } },
    });
    if (live > 0) throw new ConflictException(busy);
    await this.prisma.order.updateMany({
      where: { id: orderId, status: 'created' },
      data: { status: 'expired' },
    });
  }
}
