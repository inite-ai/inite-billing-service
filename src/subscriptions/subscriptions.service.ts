import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { SubscriptionResponseDto } from '../common/dto/subscription.dto';
import { OutboxService } from '../outbox/outbox.service';
import { CreditsService } from '../credits/credits.service';
import { FunnelService } from '../funnel/funnel.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
    @Inject(forwardRef(() => CreditsService))
    private readonly creditsService: CreditsService,
    @Inject(forwardRef(() => FunnelService))
    private readonly funnelService: FunnelService,
  ) {}

  async cancelSubscription(userId: string, subscriptionId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        userId,
      },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription not found: ${subscriptionId}`);
    }

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      },
    });
  }

  async resumeSubscription(userId: string, subscriptionId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        userId,
      },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription not found: ${subscriptionId}`);
    }

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      },
    });
  }

  async getUserSubscriptions(userId: string, serviceId?: string): Promise<SubscriptionResponseDto[]> {
    const where: any = { userId };
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

    return subscriptions.map((s) => {
      const price = s.price as any;
      const product = price?.product;
      const service = product?.service;

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
        price: price
          ? {
              id: price.id,
              code: price.code,
              amount: price.amount.toString(),
              currency: price.currency,
              interval: price.interval || undefined,
              trialDays: price.trialDays || undefined,
              product: product
                ? {
                    id: product.id,
                    code: product.code,
                    name: product.name,
                    type: product.type,
                    metadata: product.metadata || undefined,
                    service: service
                      ? { id: service.id, code: service.code, name: service.name }
                      : undefined,
                  }
                : undefined,
            }
          : undefined,
      };
    });
  }

  async startTrial(userId: string, priceCode: string, callerServiceId?: string): Promise<SubscriptionResponseDto> {
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
      throw new ConflictException('User already has an active subscription or trial for this product');
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
            },
          },
        });

        await this.outboxService.emit('billing.entitlement.granted', {
          user_id: userId,
          key,
          source: 'subscription',
          subscription_id: subscription.id,
          trial: true,
          expires_at: entitlementExpiry.toISOString(),
        }, undefined, tx);
      }

      // Grant credits if product defines them
      const metadata = product.metadata as Record<string, any> || {};
      const creditsPerPeriod = metadata.creditsPerPeriod || metadata.credits;
      if (creditsPerPeriod) {
        await this.creditsService.grant({
          userId,
          serviceId: product.serviceId || undefined,
          amount: creditsPerPeriod,
          description: `Trial credits for ${product.code}`,
          resetsAt: trialEnd,
        });
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
      await this.outboxService.emit('billing.subscription.trial_started', {
        subscription_id: subscription.id,
        user_id: userId,
        price_code: priceCode,
        trial_ends_at: trialEnd.toISOString(),
      }, undefined, tx);

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
    });
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

