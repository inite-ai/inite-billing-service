import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { OrderResponseDto, PaymentIntentResponseDto } from '../common/dto/order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserOrders(userId: string, status?: string): Promise<OrderResponseDto[]> {
    const where: any = { userId };
    if (status) {
      where.status = status;
    } else {
      // By default, exclude 'created' orders (abandoned checkout sessions)
      where.status = { not: 'created' };
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return orders.map((o) => ({
      id: o.id,
      userId: o.userId,
      priceId: o.priceId,
      mode: o.mode,
      status: o.status,
      amount: o.amount.toString(),
      currency: o.currency,
      externalId: o.externalId || undefined,
      metadata: o.metadata as Record<string, any> | undefined,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));
  }

  async getOrderById(orderId: string, userId?: string): Promise<OrderResponseDto> {
    const where: any = { id: orderId };
    if (userId) {
      where.userId = userId;
    }

    const order = await this.prisma.order.findUnique({
      where,
    });

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    return {
      id: order.id,
      userId: order.userId,
      priceId: order.priceId,
      mode: order.mode,
      status: order.status,
      amount: order.amount.toString(),
      currency: order.currency,
      externalId: order.externalId || undefined,
      metadata: order.metadata as Record<string, any> | undefined,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  async getPaymentIntentById(
    paymentIntentId: string,
    userId?: string,
  ): Promise<PaymentIntentResponseDto> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
      include: { order: true },
    });

    if (!intent) {
      throw new Error(`Payment intent not found: ${paymentIntentId}`);
    }

    if (userId && intent.order.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return {
      id: intent.id,
      orderId: intent.orderId,
      rail: intent.rail,
      status: intent.status,
      checkoutUrl: intent.checkoutUrl || undefined,
      method: intent.method || undefined,
      amount: intent.amount.toString(),
      currency: intent.currency,
      expiresAt: intent.expiresAt || undefined,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    };
  }
}
