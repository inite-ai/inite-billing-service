import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { SubscriptionResponseDto } from '../common/dto/subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { price: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return subscriptions.map((s) => ({
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
    }));
  }
}

