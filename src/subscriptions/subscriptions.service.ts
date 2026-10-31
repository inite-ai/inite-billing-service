import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { SubscriptionResponseDto } from '../common/dto/subscription.dto';
import { OutboxService } from '../outbox/outbox.service';
import { CreditsService } from '../credits/credits.service';
import { FunnelService } from '../funnel/funnel.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { ORG_MANAGERS_ONLY, SubscriberCaller, mayManage, visibleSubscribers } from './subscribers';

/** A person by their id alone (an agent's action), or with their token's organisation. */
export type SubscriptionCaller = string | SubscriberCaller;

function asCaller(caller: SubscriptionCaller): SubscriberCaller {
  return typeof caller === 'string' ? { userId: caller } : caller;
}

/** Trial setup now grants credits inside the same transaction; give it the same
 * headroom as the payment-fulfilment chain instead of Prisma's 5s default. */
const TRIAL_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
    @Inject(forwardRef(() => CreditsService))
    private readonly creditsService: CreditsService,
    @Inject(forwardRef(() => FunnelService))
    private readonly funnelService: FunnelService,
    @Inject(forwardRef(() => PaymentOrchestratorService))
    private readonly orchestrator: PaymentOrchestratorService,
  ) {}

  /**
   * A subscription the caller may move: their own, or their organisation's
   * when they are its owner or admin. One the caller cannot see is "not
   * found"; their organisation's, seen as a member, is forbidden.
   */
  private async manageable(caller: SubscriptionCaller, subscriptionId: string) {
    const who = asCaller(caller);
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, userId: { in: visibleSubscribers(who) } },
      include: { price: { include: { product: true } } },
    });
    if (!subscription) {
      throw new NotFoundException(`Subscription not found: ${subscriptionId}`);
    }
    if (!mayManage(who, subscription.userId)) {
      throw new ForbiddenException(ORG_MANAGERS_ONLY);
    }
    return subscription;
  }

  async cancelSubscription(caller: SubscriptionCaller, subscriptionId: string): Promise<void> {
    const subscription = await this.manageable(caller, subscriptionId);

    // Tell the provider to stop renewing BEFORE we flag it in our DB — otherwise
    // a DB-only "cancel" leaves the provider billing the customer next cycle.
    // Throws if the provider call fails; a no-op for rails without programmatic
    // cancel (e.g. IAP, where the user cancels in the store).
    await this.orchestrator.cancelProviderSubscription(subscription, true);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          cancelAtPeriodEnd: true,
          updatedAt: new Date(),
        },
      });
      // A person cancelling on billing's page used to tell the selling service
      // nothing until the period ended.
      if (!subscription.cancelAtPeriodEnd) {
        await this.outboxService.emit(
          'billing.subscription.cancel_scheduled',
          {
            subscription_id: subscription.id,
            user_id: subscription.userId,
            current_period_end: subscription.currentPeriodEnd.toISOString(),
          },
          { serviceId: subscription.price?.product?.serviceId ?? null, tx },
        );
      }
    });
  }

  async resumeSubscription(caller: SubscriptionCaller, subscriptionId: string): Promise<void> {
    const subscription = await this.manageable(caller, subscriptionId);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        },
      });
      if (subscription.cancelAtPeriodEnd) {
        await this.outboxService.emit(
          'billing.subscription.resumed',
          {
            subscription_id: subscription.id,
            user_id: subscription.userId,
            current_period_end: subscription.currentPeriodEnd.toISOString(),
          },
          { serviceId: subscription.price?.product?.serviceId ?? null, tx },
        );
      }
    });
  }

  async getUserSubscriptions(
    userId: string | string[],
    serviceId?: string,
  ): Promise<SubscriptionResponseDto[]> {
    const where: any = { userId: Array.isArray(userId) ? { in: userId } : userId };
    if (serviceId) {
      where.price = { product: { serviceId } };
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where,
      include: {
        price: {
          include: {
            product: {
              include: { service: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // A plan change waiting for the end of the period, by its price.
    const pendingIds = [
      ...new Set(subscriptions.map((s) => s.pendingPriceId).filter(Boolean)),
    ] as string[];
    const pending = new Map(
      (pendingIds.length
        ? await this.prisma.price.findMany({
            where: { id: { in: pendingIds } },
            include: { product: true },
          })
        : []
      ).map((p: any) => [p.id, p]),
    );

    return subscriptions.map((s) => {
      const price = s.price as any;
      const product = price?.product;
      const service = product?.service;
      const metadata = (product?.metadata || {}) as Record<string, any>;

      return {
        id: s.id,
        userId: s.userId,
        priceId: s.priceId,
        status: s.status,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        providerSubscriptionId: s.providerSubscriptionId || undefined,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        // Flat top-level fields so frontend doesn't dig through nested objects
        productName: product?.name || null,
        productCode: product?.code || null,
        productType: product?.type || null,
        productDescription: metadata.description || null,
        productFeatures: metadata.features || [],
        creditsPerPeriod: metadata.creditsPerPeriod || metadata.credits || null,
        serviceName: service?.name || null,
        // The name customers see in the catalog; `serviceName` stays the
        // operator's name, which external services already read.
        serviceDisplayName:
          (typeof (service?.metadata as any)?.displayName === 'string' &&
            (service?.metadata as any).displayName.trim()) ||
          service?.name ||
          null,
        serviceCode: service?.code || null,
        // Pricing
        amount: price ? price.amount.toString() : null,
        currency: price?.currency || null,
        interval: price?.interval || null,
        trialDays: price?.trialDays || null,
        priceCode: price?.code || null,
        pendingPriceCode: s.pendingPriceId ? pending.get(s.pendingPriceId)?.code || null : null,
        pendingProductName: s.pendingPriceId
          ? pending.get(s.pendingPriceId)?.product?.name || null
          : null,
        // No provider renews it: billing sends a pay link before it ends.
        renewsByLink: !!s.rail && !s.providerSubscriptionId && s.rail !== 'PROMO',
      };
    });
  }

  /**
   * The signed-in person's page: their own plans and their organisation's
   * (`org:<org_id>` from the verified token), each marked with whose it is and
   * whether this person may change or cancel it.
   */
  async getSubscriptionsFor(
    caller: SubscriberCaller,
    serviceCode?: string,
  ): Promise<SubscriptionResponseDto[]> {
    let serviceId: string | undefined;
    if (serviceCode !== undefined) {
      if (typeof serviceCode !== 'string' || serviceCode.length > 100) return [];
      const service = await this.prisma.service.findUnique({ where: { code: serviceCode } });
      if (!service) return [];
      serviceId = service.id;
    }
    const subs = await this.getUserSubscriptions(visibleSubscribers(caller), serviceId);
    return subs.map((s) => ({
      ...s,
      heldBy: s.userId === caller.userId ? 'self' : 'organization',
      canManage: mayManage(caller, s.userId),
    }));
  }

  /** A person's plans with one service, named by its code; none for an unknown code. */
  async getUserSubscriptionsForServiceCode(
    userId: string,
    serviceCode: string,
  ): Promise<SubscriptionResponseDto[]> {
    if (typeof serviceCode !== 'string' || serviceCode.length > 100) return [];
    const service = await this.prisma.service.findUnique({ where: { code: serviceCode } });
    if (!service) return [];
    return this.getUserSubscriptions(userId, service.id);
  }

  async startTrial(
    userId: string,
    priceCode: string,
    callerServiceId?: string,
  ): Promise<SubscriptionResponseDto> {
    const price = await this.prisma.price.findUnique({
      where: { code: priceCode },
      include: { product: true },
    });

    if (!price || !price.isActive) {
      throw new NotFoundException(`Price not found: ${priceCode}`);
    }

    if (!price.trialDays || price.trialDays <= 0) {
      throw new BadRequestException('This price does not offer a trial period');
    }

    // Service scope isolation: service API key can only trial its own products
    if (callerServiceId && price.product.serviceId !== callerServiceId) {
      throw new BadRequestException('Price does not belong to this service');
    }

    // Check for existing trial or active subscription on the same product
    const existingSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        price: { productId: price.productId },
        status: { in: ['trialing', 'active', 'past_due'] },
      },
    });

    if (existingSubscription) {
      throw new ConflictException(
        'User already has an active subscription or trial for this product',
      );
    }

    // Check if user already had a trial for this product (prevent trial abuse)
    const pastTrial = await this.prisma.subscription.findFirst({
      where: {
        userId,
        price: { productId: price.productId },
        status: { in: ['canceled', 'ended'] },
      },
    });

    if (pastTrial) {
      throw new ConflictException('User has already used a trial for this product');
    }

    const now = new Date();
    const trialEnd = new Date(now.getTime() + price.trialDays * 24 * 60 * 60 * 1000);
    const graceDays = price.graceDays || 0;
    const entitlementExpiry = new Date(trialEnd.getTime() + graceDays * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      // Create subscription with trialing status
      const subscription = await tx.subscription.create({
        data: {
          userId,
          priceId: price.id,
          status: 'trialing',
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
          cancelAtPeriodEnd: false,
        },
      });

      // Grant entitlements
      const product = price.product;
      const entitlementKeys = this.extractEntitlementKeys(product);

      for (const key of entitlementKeys) {
        await tx.entitlement.create({
          data: {
            userId,
            key,
            status: 'active',
            source: 'subscription',
            startsAt: now,
            expiresAt: entitlementExpiry,
            value: {
              subscription_id: subscription.id,
              product_code: product.code,
              trial: true,
              service_id: product.serviceId ?? null,
            },
          },
        });

        await this.outboxService.emit(
          'billing.entitlement.granted',
          {
            user_id: userId,
            key,
            source: 'subscription',
            subscription_id: subscription.id,
            trial: true,
            expires_at: entitlementExpiry.toISOString(),
          },
          { serviceId: product.serviceId ?? null, tx },
        );
      }

      // Grant credits if product defines them
      const metadata = (product.metadata as Record<string, any>) || {};
      const creditsPerPeriod = metadata.creditsPerPeriod || metadata.credits;
      if (creditsPerPeriod) {
        await this.creditsService.grant(
          {
            userId,
            serviceId: product.serviceId || undefined,
            amount: creditsPerPeriod,
            description: `Trial credits for ${product.code}`,
            resetsAt: trialEnd,
          },
          tx,
        );
      }

      // Track funnel event
      this.funnelService.track({
        userId,
        eventType: 'trial_started',
        stage: 'retention',
        productId: product.id,
        serviceId: product.serviceId ?? undefined,
        properties: { subscriptionId: subscription.id, trialDays: price.trialDays },
      });

      // Emit outbox event
      await this.outboxService.emit(
        'billing.subscription.trial_started',
        {
          subscription_id: subscription.id,
          user_id: userId,
          price_code: priceCode,
          trial_ends_at: trialEnd.toISOString(),
        },
        { serviceId: product.serviceId ?? null, tx },
      );

      return {
        id: subscription.id,
        userId: subscription.userId,
        priceId: subscription.priceId,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      };
    }, TRIAL_TX_OPTIONS);
  }

  private extractEntitlementKeys(product: any): string[] {
    const metadata = product.metadata || {};
    if (Array.isArray(metadata.entitlements)) {
      return metadata.entitlements;
    }
    if (typeof metadata.entitlementKey === 'string') {
      return [metadata.entitlementKey];
    }
    return [product.code];
  }
}
