import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RiskService } from '../risk/risk.service';
import { PrismaService } from '../common/services/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { FunnelService } from '../funnel/funnel.service';
import {
  CreateCheckoutSessionDto,
  CheckoutSessionResponseDto,
  PaySessionResponseDto,
} from '../common/dto/checkout.dto';
import { v4 as uuidv4 } from 'uuid';
import { resolveFrontendUrl } from '../common/config/frontend-url';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  /** Fallback idempotency store when Redis is unavailable (single-instance
   * only — does not survive restart or span instances). */
  private readonly idempotencyStore: Map<string, CheckoutSessionResponseDto> = new Map();
  private redis: Redis | null = null;
  private static readonly IDEM_TTL_SECONDS = 3600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly paymentOrchestrator: PaymentOrchestratorService,
    private readonly affiliatesService: AffiliatesService,
    private readonly promoCodesService: PromoCodesService,
    private readonly funnelService: FunnelService,
    private readonly configService: ConfigService,
    @Optional() private readonly riskService?: RiskService,
  ) {}

  /**
   * Lazily-created Redis client for cross-instance / restart-surviving
   * idempotency. Null when REDIS_URL is unset — callers fall back to the
   * in-process Map. Errors are logged, never thrown (idempotency is best-effort).
   */
  private getRedis(): Redis | null {
    if (this.redis) return this.redis;
    const url = this.configService.get<string>('REDIS_URL');
    if (!url) return null;
    try {
      this.redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
      this.redis.on('error', (err) =>
        this.logger.warn(`Redis error (checkout idempotency): ${err.message}`),
      );
      return this.redis;
    } catch {
      return null;
    }
  }

  private async idempotencyGet(key: string): Promise<CheckoutSessionResponseDto | null> {
    const redis = this.getRedis();
    if (redis) {
      try {
        const raw = await redis.get(key);
        return raw ? (JSON.parse(raw) as CheckoutSessionResponseDto) : null;
      } catch (err: any) {
        this.logger.warn(`Redis idempotency read failed, falling back: ${err.message}`);
      }
    }
    return this.idempotencyStore.get(key) ?? null;
  }

  private async idempotencySet(key: string, value: CheckoutSessionResponseDto): Promise<void> {
    const redis = this.getRedis();
    if (redis) {
      try {
        await redis.set(key, JSON.stringify(value), 'EX', CheckoutService.IDEM_TTL_SECONDS);
        return;
      } catch (err: any) {
        this.logger.warn(`Redis idempotency write failed, falling back: ${err.message}`);
      }
    }
    this.idempotencyStore.set(key, value);
    // unref so the eviction timer never keeps the process (or a test run) alive.
    setTimeout(
      () => this.idempotencyStore.delete(key),
      CheckoutService.IDEM_TTL_SECONDS * 1000,
    ).unref();
  }

  /**
   * List active payment providers for checkout.
   */
  async getPaymentMethods() {
    return this.prisma.paymentProvider.findMany({
      where: { isActive: true },
      select: { code: true, name: true, supportedModes: true, currencies: true },
    });
  }

  /**
   * Phase 1: Create checkout session.
   * Creates an order with status 'created' but does NOT create a PaymentIntent.
   * Returns { sessionId, checkoutUrl } pointing to the billing frontend checkout page.
   */
  async createSession(
    userId: string,
    dto: CreateCheckoutSessionDto,
    idempotencyKey?: string,
    clientIp?: string,
  ): Promise<CheckoutSessionResponseDto> {
    // Idempotency check (Redis-backed so it survives restarts and is shared
    // across instances; falls back to an in-process Map if Redis is absent).
    const idemKey = idempotencyKey ? `checkout:idem:${userId}:${idempotencyKey}` : null;
    if (idemKey) {
      const existing = await this.idempotencyGet(idemKey);
      if (existing) {
        this.logger.debug(
          `Returning existing checkout session for idempotency key: ${idempotencyKey}`,
        );
        return existing;
      }
    }

    // Get price (includes product via CatalogService)
    const price = await this.catalogService.getPriceByCode(dto.priceCode);
    const product = price.product;

    if (!product) {
      throw new NotFoundException(`Product not found for price: ${dto.priceCode}`);
    }

    // Reject checkout if the product is inactive
    if (!product.isActive) {
      throw new BadRequestException(`Product ${product.code} is not active`);
    }

    // Validate mode matches product type
    if (dto.mode === 'SUBSCRIPTION' && product.type !== 'subscription') {
      throw new BadRequestException(`Product ${product.code} is not a subscription product`);
    }
    if (dto.mode === 'PAYMENT' && product.type === 'subscription') {
      throw new BadRequestException(
        `Product ${product.code} is a subscription product, use SUBSCRIPTION mode`,
      );
    }

    // Handle referral code if provided
    if (dto.referralCode) {
      const affiliate = await this.affiliatesService.getAffiliateByCode(dto.referralCode);
      if (affiliate) {
        // Self-referral prevention
        if (affiliate.userId === userId) {
          this.logger.debug(`Self-referral blocked for user ${userId}`);
        } else {
          try {
            await this.affiliatesService.trackReferral(affiliate.id, userId, dto.referralCode);
          } catch (error: any) {
            this.logger.debug(`Referral tracking: ${error.message}`);
          }
        }
      }
    }

    // Create order with status 'created' — do NOT create payment intent
    const order = await this.prisma.order.create({
      data: {
        userId,
        priceId: price.id,
        mode: dto.mode,
        status: 'created',
        amount: price.amount,
        currency: price.currency,
        externalId: `order_${uuidv4()}`,
        metadata: {
          ...dto.metadata,
          referralCode: dto.referralCode,
          successUrl: dto.successUrl,
          errorUrl: dto.errorUrl,
        },
      },
    });

    // Risk assessment (monitor-only unless RISK_BLOCKING_ENABLED)
    if (this.riskService) {
      try {
        const risk = await this.riskService.assessCheckout(order, {
          ip: clientIp,
        });
        if (risk.status === 'blocked') {
          await this.prisma.order.update({
            where: { id: order.id },
            data: {
              status: 'failed',
              metadata: { ...(order.metadata as any), riskBlocked: true },
            },
          });
          throw new BadRequestException('This order cannot be processed. Please contact support.');
        }
      } catch (error: any) {
        if (error instanceof BadRequestException) throw error;
        // Risk scoring must never break checkout
        this.logger.warn(`Risk assessment failed: ${error.message}`);
      }
    }

    // Track funnel event: checkout_started
    this.funnelService.track({
      userId,
      eventType: 'checkout_started',
      stage: 'checkout',
      orderId: order.id,
      productId: price.productId,
      serviceId: product.serviceId ?? undefined,
      amount: Number(order.amount),
      currency: order.currency,
      properties: {
        priceCode: dto.priceCode,
        referralCode: dto.referralCode,
      },
    });

    const frontendUrl = resolveFrontendUrl(this.configService);
    const response: CheckoutSessionResponseDto = {
      sessionId: order.id,
      checkoutUrl: `${frontendUrl}/checkout/${order.id}`,
    };

    // Store for idempotency
    if (idemKey) {
      await this.idempotencySet(idemKey, response);
    }

    return response;
  }

  /**
   * Get session details for the checkout page.
   * Returns order info, product, price, and available payment methods.
   */
  async getSession(sessionId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: sessionId },
      include: {
        price: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Checkout session not found');
    }

    // If userId provided, verify ownership
    if (userId && order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this session');
    }

    // Get available payment methods
    const paymentMethods = await this.prisma.paymentProvider.findMany({
      where: { isActive: true },
      select: {
        code: true,
        name: true,
        supportedModes: true,
        currencies: true,
      },
    });

    const metadata = (order.metadata as Record<string, any>) || {};

    return {
      sessionId: order.id,
      status: order.status,
      product: {
        name: order.price.product.name,
        code: order.price.product.code,
        type: order.price.product.type,
        description: (order.price.product.metadata as Record<string, any>)?.description || null,
      },
      price: {
        code: order.price.code,
        amount: order.amount,
        currency: order.currency,
        interval: order.price.interval,
      },
      mode: order.mode,
      successUrl: metadata.successUrl || null,
      errorUrl: metadata.errorUrl || null,
      paymentMethods,
    };
  }

  /**
   * Phase 2: Initiate payment for a checkout session.
   * Validates promo code, applies discount, creates PaymentIntent.
   * If amount is 0 (100% discount), fulfills immediately and returns successUrl.
   */
  async paySession(
    sessionId: string,
    userId: string,
    data: { rail?: string; promoCode?: string },
  ): Promise<PaySessionResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: sessionId },
      include: {
        price: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Checkout session not found');
    }

    if (order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this session');
    }

    if (order.status !== 'created') {
      throw new BadRequestException(`Order is in '${order.status}' status and cannot be paid`);
    }

    const price = order.price;
    const product = price.product;
    const metadata = (order.metadata as Record<string, any>) || {};
    let orderAmount = Number(order.amount);
    const originalAmount = orderAmount;

    // Validate + apply promo code if provided (wrapped in transaction to prevent race conditions)
    let promoValidation: any = null;
    if (data.promoCode) {
      promoValidation = await this.promoCodesService.validatePromoCode(
        data.promoCode,
        price.id,
        userId,
      );

      if (!promoValidation.isValid) {
        throw new BadRequestException(`Invalid promo code: ${promoValidation.error}`);
      }

      orderAmount = promoValidation.finalAmount;

      // Atomic transaction: re-check per-user limit + increment usage + create record + update order
      await this.prisma.$transaction(async (tx) => {
        // Re-check per-user limit INSIDE transaction to prevent TOCTOU race
        if (promoValidation.promoCode.maxUsagePerUser !== null) {
          const userUsageCount = await tx.promoCodeUsage.count({
            where: {
              promoCodeId: promoValidation.promoCode.id,
              userId,
            },
          });
          if (userUsageCount >= promoValidation.promoCode.maxUsagePerUser) {
            throw new BadRequestException('Promo code per-user limit reached');
          }
        }

        // Atomically increment global usage count with WHERE condition to prevent race
        const updated = await tx.promoCode.updateMany({
          where: {
            id: promoValidation.promoCode.id,
            currentUsageCount: {
              lt: promoValidation.promoCode.maxUsageCount || 999999999,
            },
          },
          data: { currentUsageCount: { increment: 1 } },
        });
        if (updated.count === 0) {
          throw new BadRequestException('Promo code usage limit reached');
        }

        // Create usage record
        await tx.promoCodeUsage.create({
          data: {
            promoCodeId: promoValidation.promoCode.id,
            orderId: order.id,
            userId,
            discountApplied: promoValidation.discountAmount,
            originalAmount,
            finalAmount: promoValidation.finalAmount,
          },
        });

        // Update order with discounted amount and promo metadata
        await tx.order.update({
          where: { id: order.id },
          data: {
            amount: orderAmount,
            metadata: {
              ...metadata,
              promoCode: data.promoCode,
              promoCodeId: promoValidation.promoCode.id,
              originalAmount,
              discountAmount: promoValidation.discountAmount,
            },
          },
        });
      });
    }

    const successUrl = metadata.successUrl || '';
    const errorUrl = metadata.errorUrl || '';

    // If amount is 0 (100% discount), skip payment — fulfill immediately
    if (orderAmount === 0) {
      const paymentIntent = await this.prisma.paymentIntent.create({
        data: {
          orderId: order.id,
          rail: 'PROMO',
          status: 'created',
          providerIntentId: `promo_${order.id}`,
          amount: 0,
          currency: price.currency,
          snapshot: { promoCode: data.promoCode, fullDiscount: true },
        },
      });

      // Transition created → paid triggers full fulfillment (order status, entitlements, etc.)
      await this.paymentOrchestrator.applyStateTransition(paymentIntent.id, 'paid');

      return {
        checkoutUrl: successUrl,
        paymentIntentId: paymentIntent.id,
      };
    }

    // Determine rail for payment
    let rail: string;
    if (data.rail) {
      rail = data.rail;
    } else {
      const activeProvider = await this.prisma.paymentProvider.findFirst({
        where: { isActive: true },
      });
      if (!activeProvider) {
        throw new BadRequestException('No payment providers are configured.');
      }
      rail = activeProvider.code;
    }

    // Reuse a still-live intent for this order + rail instead of creating a
    // second one. Without this a double-click / retry (or two tabs) issues two
    // payment URLs for the same order — the customer can pay both and get
    // double-charged. A DIFFERENT rail is a deliberate method switch, so it
    // still creates a fresh intent (the previous one abandons/expires).
    const liveIntent = await this.prisma.paymentIntent.findFirst({
      where: { orderId: order.id, rail, status: { in: ['created', 'opened'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (liveIntent) {
      this.logger.log(
        `Reusing live payment intent ${liveIntent.id} for order ${order.id} (${rail})`,
      );
      return {
        checkoutUrl: liveIntent.checkoutUrl || '',
        paymentIntentId: liveIntent.id,
      };
    }

    // Get adapter
    let adapter;
    try {
      adapter = this.paymentOrchestrator.getAdapter(rail);
    } catch {
      throw new BadRequestException(
        `Payment provider ${rail} is not available. Please select another payment method.`,
      );
    }

    // Create payment intent with adapter
    const intentResult = await adapter.createPaymentIntent({
      orderId: order.externalId!,
      amount: orderAmount,
      currency: price.currency,
      mode: order.mode,
      successUrl,
      errorUrl,
      metadata: {
        ...metadata,
        order_id: order.id,
        price_code: price.code,
        product_code: product.code,
      },
    });

    // Create payment intent record. The partial unique index
    // (payment_intents_one_live_per_order) enforces one live intent per order at
    // the DB level, closing the race the reuse-check above can't (two requests
    // that both miss the check before either inserts). If a concurrent request
    // won, our insert hits a unique violation (P2002) — reuse the winner's intent
    // instead of surfacing a 500. Our own provider intent is left to expire.
    let paymentIntent;
    try {
      paymentIntent = await this.prisma.paymentIntent.create({
        data: {
          orderId: order.id,
          rail,
          status: 'created',
          providerIntentId: intentResult.providerIntentId,
          providerCheckoutId: intentResult.providerCheckoutId,
          checkoutUrl: intentResult.checkoutUrl,
          amount: orderAmount,
          currency: price.currency,
          expiresAt: intentResult.expiresAt,
          snapshot: intentResult.metadata || {},
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const winner = await this.prisma.paymentIntent.findFirst({
          where: { orderId: order.id, rail, status: { in: ['created', 'opened'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (winner) {
          this.logger.log(
            `Concurrent intent race for order ${order.id} (${rail}) — reusing ${winner.id}`,
          );
          return { checkoutUrl: winner.checkoutUrl || '', paymentIntentId: winner.id };
        }
      }
      throw error;
    }

    return {
      checkoutUrl: intentResult.checkoutUrl || '',
      paymentIntentId: paymentIntent.id,
    };
  }
}
