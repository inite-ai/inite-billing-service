import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/services/prisma.service';
import { isGuestUserId } from '../checkout/checkout.service';
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
      snapshot: (o.snapshot as Record<string, any> | null) ?? undefined,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));
  }

  /**
   * One order. A user sees their own; a service key (`serviceId`) sees the
   * orders for its own products, whoever the buyer is — that is how a service
   * selling to guests (mikefluff.com) learns whether its order was paid, even
   * after the buyer's INITE account claimed it at checkout.
   */
  async getOrderById(
    orderId: string,
    userId?: string,
    serviceId?: string,
  ): Promise<OrderResponseDto> {
    const where: any = { id: orderId };
    if (userId) {
      where.userId = userId;
    }

    const order = serviceId
      ? await this.prisma.order.findFirst({
          where: { ...where, price: { product: { serviceId } } },
        })
      : await this.prisma.order.findUnique({
          where,
        });

    if (!order) {
      // A service asking for another service's order gets the same answer as
      // for one that does not exist.
      if (serviceId) throw new NotFoundException('Order not found');
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
      snapshot: (order.snapshot as Record<string, any> | null) ?? undefined,
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

  /**
   * A store that sells without accounts (mikefluff.com) opens orders for a
   * made-up guest id and records the buyer's email. When that buyer signs in
   * with the same address, confirmed by the identity provider, those orders
   * and the access they granted become theirs: the dashboard shows them, and
   * the next purchase is already on the account. The guest id stays in
   * `metadata.guestUserId`; the order id does not change, so a store that
   * reconciles by order id sees no difference. An unconfirmed address claims
   * nothing — anyone can type someone else's email into a store.
   */
  async claimGuestPurchases(
    userId: string,
    email: string | undefined,
    emailVerified: boolean | undefined,
    /**
     * A selling service vouching for its own signed-in user: only orders for
     * that service's products move.
     */
    serviceId?: string,
  ): Promise<{ claimed: string[] }> {
    const address = email?.trim().toLowerCase();
    if (!address || !emailVerified || isGuestUserId(userId)) return { claimed: [] };

    const rows = await this.prisma.$queryRaw<Array<{ id: string; user_id: string }>>(Prisma.sql`
      SELECT o.id, o.user_id FROM billing.orders o
      JOIN billing.prices pr ON pr.id = o.price_id
      JOIN billing.products p ON p.id = pr.product_id
      WHERE lower(trim(o.metadata->>'email')) = ${address}
        AND position(':' in o.user_id) > 0
        AND o.user_id NOT LIKE 'did:%'
        AND o.user_id NOT LIKE 'org:%'
        ${serviceId ? Prisma.sql`AND p.service_id = ${serviceId}::uuid` : Prisma.empty}
    `);

    const claimed: string[] = [];
    for (const row of rows) {
      if (!isGuestUserId(row.user_id)) continue;
      await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: row.id },
          select: { userId: true, metadata: true },
        });
        if (order?.userId !== row.user_id) return;
        const metadata = {
          ...((order.metadata as Record<string, unknown>) || {}),
          guestUserId: row.user_id,
          claimedAt: new Date().toISOString(),
        };
        // Conditional on the guest still owning it: two tabs signing in at
        // once move it once.
        const moved = await tx.order.updateMany({
          where: { id: row.id, userId: row.user_id },
          data: { userId, metadata },
        });
        if (moved.count !== 1) return;
        await tx.entitlement.updateMany({
          where: { userId: row.user_id, value: { path: ['order_id'], equals: row.id } },
          data: { userId },
        });
        claimed.push(row.id);
      });
    }
    return { claimed };
  }
}
