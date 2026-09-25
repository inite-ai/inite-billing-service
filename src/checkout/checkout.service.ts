import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import { randomUUID } from 'node:crypto';
import { Connector } from '../common/connectors/connector.interface';
import { CreateIntentInput } from '../common/interfaces/payment-rail-adapter.interface';
import { moneyToNumber, toMoney } from '../common/money';
import { resolveFrontendUrl } from '../common/config/frontend-url';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  /** Fallback idempotency store when Redis is unavailable (single-instance
   * only — does not survive restart or span instances). */
  private readonly idempotencyStore: Map<string, CheckoutSessionResponseDto | string> = new Map();
  /** Written while the session is being created, replaced by the response. */
  private static readonly IDEM_IN_FLIGHT = '__in_flight__';
  /** How long a claim survives if the request dies without releasing it. */
  private static readonly IDEM_IN_FLIGHT_SECONDS = 60;
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

  /**
   * Claim an idempotency key, or report what already holds it.
   *
   * This used to be a plain read followed, much later, by a write. Two requests
   * carrying the same key — a double-clicked button, a client retry after a
   * timeout — both read nothing and both went on to create an order, which is
   * the one thing an idempotency key is for. The claim is now atomic: the first
   * request takes the key, the second is told the work is already happening.
   */
  private async idempotencyClaim(
    key: string,
  ): Promise<
    | { kind: 'claimed' }
    | { kind: 'completed'; value: CheckoutSessionResponseDto }
    | { kind: 'in_flight' }
  > {
    const redis = this.getRedis();
    if (redis) {
      try {
        const claimed = await redis.set(
          key,
          CheckoutService.IDEM_IN_FLIGHT,
          'EX',
          CheckoutService.IDEM_IN_FLIGHT_SECONDS,
          'NX',
        );
        if (claimed) return { kind: 'claimed' };

        const raw = await redis.get(key);
        if (!raw) return { kind: 'claimed' }; // expired between the two calls
        if (raw === CheckoutService.IDEM_IN_FLIGHT) return { kind: 'in_flight' };
        return { kind: 'completed', value: JSON.parse(raw) as CheckoutSessionResponseDto };
      } catch (err: any) {
        this.logger.warn(`Redis idempotency claim failed, falling back: ${err.message}`);
      }
    }

    // Single-instance fallback. Node runs this to completion between awaits, so
    // the read and the write below cannot interleave within one process.
    const held = this.idempotencyStore.get(key);
    if (held === undefined) {
      this.idempotencyStore.set(key, CheckoutService.IDEM_IN_FLIGHT);
      return { kind: 'claimed' };
    }
    if (typeof held === 'string') return { kind: 'in_flight' };
    return { kind: 'completed', value: held };
  }

  /** Release a claim so a failed attempt can be retried immediately. */
  private async idempotencyRelease(key: string): Promise<void> {
    const redis = this.getRedis();
    if (redis) {
      try {
        await redis.del(key);
        return;
      } catch (err: any) {
        this.logger.warn(`Redis idempotency release failed: ${err.message}`);
      }
    }
    this.idempotencyStore.delete(key);
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
    /**
     * The service whose API key made this call, when one did. A service may
     * only sell its own catalogue: without this, any module's key could open a
     * checkout for another module's product, and the resulting order, revenue
     * and affiliate commission would land in the other module's books.
     */
    callerServiceId?: string,
  ): Promise<CheckoutSessionResponseDto> {
    // Idempotency check (Redis-backed so it survives restarts and is shared
    // across instances; falls back to an in-process Map if Redis is absent).
    const idemKey = idempotencyKey ? `checkout:idem:${userId}:${idempotencyKey}` : null;
    if (idemKey) {
      const claim = await this.idempotencyClaim(idemKey);
      if (claim.kind === 'completed') {
        this.logger.debug(
          `Returning existing checkout session for idempotency key: ${idempotencyKey}`,
        );
        return claim.value;
      }
      if (claim.kind === 'in_flight') {
        // The first request is still creating this order. Answering "not yet"
        // is the only honest reply: inventing a second order would defeat the
        // key, and returning nothing would look like success.
        throw new ConflictException(
          'A checkout with this idempotency key is already being created',
        );
      }
    }

    // From here on the key is held. Anything that throws must release it, or a
    // failed attempt would lock the client out of retrying for the full TTL.
    try {
      return await this.buildSession(userId, dto, idemKey, clientIp, callerServiceId);
    } catch (error) {
      if (idemKey) await this.idempotencyRelease(idemKey);
      throw error;
    }
  }

  private async buildSession(
    userId: string,
    dto: CreateCheckoutSessionDto,
    idemKey: string | null,
    clientIp?: string,
    callerServiceId?: string,
  ): Promise<CheckoutSessionResponseDto> {
    // Get price (includes product via CatalogService)
    const price = await this.catalogService.getPriceByCode(dto.priceCode);
    const product = price.product;

    if (!product) {
      throw new NotFoundException(`Product not found for price: ${dto.priceCode}`);
    }

    if (callerServiceId && product.serviceId !== callerServiceId) {
      // Deliberately the same message as an unknown price: a service key should
      // not be able to enumerate another service's catalogue by watching which
      // codes come back "wrong tenant" versus "not found".
      throw new NotFoundException(`Price not found: ${dto.priceCode}`);
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
        externalId: `order_${randomUUID()}`,
        // What was bought, as it read at this moment. Without it, renaming a
        // product or repricing it rewrites what every past order says it was
        // for.
        snapshot: {
          priceCode: price.code,
          priceAmount: price.amount.toString(),
          currency: price.currency,
          interval: price.interval ?? null,
          trialDays: price.trialDays ?? null,
          productCode: product.code,
          productName: product.name,
          productType: product.type,
          serviceId: product.serviceId ?? null,
          capturedAt: new Date().toISOString(),
        },
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
  async getSession(sessionId: string, userId?: string, callerServiceId?: string) {
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

    // A service key used to skip the ownership check entirely, which made every
    // checkout session in the platform readable by any registered module —
    // user id, product, amount and all. A service sees its own sessions.
    if (callerServiceId && order.price?.product?.serviceId !== callerServiceId) {
      throw new NotFoundException('Checkout session not found');
    }

    // Get available payment methods
    const providers = await this.prisma.paymentProvider.findMany({
      where: { isActive: true },
      select: {
        code: true,
        name: true,
        supportedModes: true,
        currencies: true,
      },
    });

    // A rail that declares which currencies it can take is not offered for a
    // price in any other — crypto sells dollar prices only. A rail whose
    // customer picks a method first (a crypto network) brings its options,
    // and is not offered when it has none to give.
    const paymentMethods: Array<(typeof providers)[number] & { options?: unknown[] }> = [];
    for (const provider of providers) {
      let connector: Connector | null = null;
      try {
        connector = this.paymentOrchestrator.getAdapter(provider.code) as Connector;
      } catch {
        connector = null;
      }
      const capabilities = connector?.capabilities?.();
      if (
        capabilities?.currencies?.length &&
        !capabilities.currencies.includes(String(order.currency).toUpperCase())
      ) {
        continue;
      }
      if (capabilities?.selectableMethods && connector) {
        const options = connector.listMethods
          ? await connector.listMethods({ currency: order.currency }).catch(() => [])
          : [];
        if (options.length === 0) continue;
        paymentMethods.push({ ...provider, options });
        continue;
      }
      paymentMethods.push(provider);
    }

    // The payment already under way, for a rail with no page of its own: the
    // checkout page shows the crypto invoice again after a reload, and keeps
    // showing its progress once the order has moved past `created`.
    const latestIntent = await this.prisma.paymentIntent.findFirst({
      where: { orderId: order.id, status: { in: ['created', 'opened', 'paid'] } },
      orderBy: { createdAt: 'desc' },
    });
    let payment: Record<string, any> | null = null;
    // A payment the customer is completing on the provider's own page: the
    // checkout page shows "finish paying" and keeps checking, instead of
    // calling a session that is merely waiting "expired".
    const pending =
      latestIntent &&
      ['created', 'opened'].includes(latestIntent.status) &&
      latestIntent.checkoutUrl
        ? {
            rail: latestIntent.rail,
            status: latestIntent.status,
            checkoutUrl: latestIntent.checkoutUrl,
          }
        : null;
    if (latestIntent) {
      try {
        const connector = this.paymentOrchestrator.getAdapter(latestIntent.rail) as Connector;
        const described = connector.describeIntent
          ? await connector.describeIntent(latestIntent)
          : null;
        payment = described
          ? { ...described, rail: latestIntent.rail, intentStatus: latestIntent.status }
          : null;
      } catch {
        payment = null;
      }
    }

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
      payment,
      pending,
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
    data: {
      rail?: string;
      promoCode?: string;
      cryptoChain?: string;
      cryptoToken?: string;
      method?: string;
    },
    buyerEmail?: string,
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
    // Decimal is what is stored and what is written back; the number below is
    // only for the adapter interface, which takes one.
    let orderAmountDecimal = toMoney(order.amount);
    const originalAmount = moneyToNumber(orderAmountDecimal);

    // Validate + apply promo code if provided (wrapped in transaction to prevent race conditions)
    let promoValidation: any = null;
    // The same code sent again with a second pay call — a crypto customer
    // switching network, a retry — was already applied to this order's amount
    // and counted against its limits. Applying it twice would refuse the
    // customer for having used their one redemption on this very order.
    const promoAlreadyApplied =
      !!data.promoCode && !!metadata.promoCodeId && metadata.promoCode === data.promoCode;
    if (data.promoCode && !promoAlreadyApplied) {
      promoValidation = await this.promoCodesService.validatePromoCode(
        data.promoCode,
        price.id,
        userId,
      );

      if (!promoValidation.isValid) {
        throw new BadRequestException(`Invalid promo code: ${promoValidation.error}`);
      }

      orderAmountDecimal = toMoney(promoValidation.finalAmount);

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
            amount: orderAmountDecimal,
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
    const orderAmount = moneyToNumber(orderAmountDecimal);
    if (orderAmountDecimal.isZero()) {
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

    let adapter: Connector | null;
    try {
      adapter = (this.paymentOrchestrator.getAdapter(rail) as Connector) ?? null;
    } catch {
      adapter = null;
    }

    const intentInput: CreateIntentInput = {
      orderId: order.externalId!,
      amount: orderAmount,
      currency: price.currency,
      mode: order.mode,
      successUrl,
      errorUrl,
      cryptoChainId: data.cryptoChain,
      cryptoToken: data.cryptoToken,
      method: data.method,
      metadata: {
        ...metadata,
        order_id: order.id,
        price_code: price.code,
        product_code: product.code,
        // Rails that collect the buyer's email (lava.top requires one) and
        // send the customer back when they are done.
        buyerEmail:
          metadata.buyerEmail || metadata.email || (await this.buyerEmail(userId, buyerEmail)),
        returnUrl: `${resolveFrontendUrl(this.configService)}/orders`,
        checkoutReturnUrl: `${resolveFrontendUrl(this.configService)}/checkout/${order.id}`,
      },
    };

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
      // Unless the rail says this request needs a new one — a crypto customer
      // who switched network, or whose invoice ran out of time. The old intent
      // is closed without touching the order, which is still being paid for.
      const replace = adapter?.replaceLiveIntent
        ? await adapter.replaceLiveIntent(liveIntent, intentInput)
        : false;
      if (!replace) {
        this.logger.log(
          `Reusing live payment intent ${liveIntent.id} for order ${order.id} (${rail})`,
        );
        return {
          checkoutUrl: liveIntent.checkoutUrl || '',
          paymentIntentId: liveIntent.id,
          ...(await this.describe(adapter, liveIntent)),
        };
      }
      await adapter?.releaseIntent?.(liveIntent);
      await this.prisma.paymentIntent.updateMany({
        where: { id: liveIntent.id, status: 'created' },
        data: { status: 'expired' },
      });
      this.logger.log(`Replaced payment intent ${liveIntent.id} for order ${order.id} (${rail})`);
    }

    if (!adapter) {
      throw new BadRequestException(
        `Payment provider ${rail} is not available. Please select another payment method.`,
      );
    }

    // Create payment intent with adapter
    const intentResult = await adapter.createPaymentIntent(intentInput);
    const crypto = rail === 'CRYPTO' ? intentResult.metadata || {} : null;

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
          amount: orderAmountDecimal,
          currency: price.currency,
          expiresAt: intentResult.expiresAt,
          snapshot: intentResult.metadata || {},
          ...(crypto
            ? {
                method: 'crypto',
                cryptoChainId: crypto.chain ?? null,
                cryptoToken: crypto.token ?? null,
                cryptoAmount: crypto.amount ?? null,
                receiverAddress: crypto.receiverAddress ?? null,
              }
            : {}),
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        await adapter.releaseIntent?.({ providerIntentId: intentResult.providerIntentId });
        const winner = await this.prisma.paymentIntent.findFirst({
          where: { orderId: order.id, rail, status: { in: ['created', 'opened'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (winner) {
          this.logger.log(
            `Concurrent intent race for order ${order.id} (${rail}) — reusing ${winner.id}`,
          );
          return {
            checkoutUrl: winner.checkoutUrl || '',
            paymentIntentId: winner.id,
            ...(await this.describe(adapter, winner)),
          };
        }
      }
      throw error;
    }

    return {
      checkoutUrl: intentResult.checkoutUrl || '',
      paymentIntentId: paymentIntent.id,
      ...(await this.describe(adapter, paymentIntent)),
    };
  }

  /**
   * Ask the provider about this session's payment now and apply the answer,
   * then return the session as it stands. What the checkout page calls when
   * the customer comes back from the provider's page, and while it waits —
   * so the order is settled even when no webhook arrives.
   */
  async refreshPayment(sessionId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: sessionId } });
    if (!order) throw new NotFoundException('Checkout session not found');
    if (order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this session');
    }
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { orderId: order.id, status: { in: ['created', 'opened'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (intent?.providerIntentId) {
      try {
        await this.paymentOrchestrator.syncIntentWithProvider(intent.id);
      } catch (error: any) {
        // The provider being slow is not the customer's error; the page asks again.
        this.logger.warn(`Could not check payment ${intent.id}: ${error.message}`);
      }
    }
    return this.getSession(sessionId, userId);
  }

  /**
   * The buyer's email: from their token, or the last one this service saw
   * for them. Undefined when neither exists; a rail that needs one says so.
   */
  private async buyerEmail(userId: string, fromToken?: string): Promise<string | undefined> {
    if (fromToken) return fromToken;
    const contact = await this.prisma.userContact
      ?.findUnique({ where: { userId }, select: { email: true } })
      .catch(() => null);
    return contact?.email ?? undefined;
  }

  /**
   * Payment instructions for a rail that has no page to redirect to, as a
   * fragment of the pay response — empty for rails that redirect.
   */
  private async describe(
    adapter: Connector | null,
    intent: { providerIntentId: string | null; status: string; snapshot: unknown },
  ): Promise<{ payment?: Record<string, any> }> {
    const payment = adapter?.describeIntent ? await adapter.describeIntent(intent) : null;
    return payment ? { payment } : {};
  }
}
