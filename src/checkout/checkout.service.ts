import { checkItem, itemTemplate } from '../catalog/item-entitlements';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
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
import { moneyToNumber, roundMoney, toMoney } from '../common/money';
import { resolveFrontendUrl } from '../common/config/frontend-url';
import { summarizeProviderError } from '../common/helpers/provider-error';
import { checkoutLinkMatches, newCheckoutLink } from './checkout-link';
import { productTranslations } from '../catalog/product-i18n';
import {
  checkBounds,
  checkRef,
  openConfig,
  openEntitlementKey,
  openPriceCode,
  parseOpenAmount,
  sanitizeTitle,
  SAFE_REF,
} from './open-product';
import { OpenSalePolicy } from './open-sale.policy';
import { isOrgSubscriber } from '../common/validators/is-user-id';

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
    @Optional() private readonly openPolicy?: OpenSalePolicy,
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
    // A subscription product's price with a period may also be bought once:
    // a year paid up front, no renewal, access for exactly that period
    // (grantEntitlementsForOrder → orderAccessEndsAt, #191). Refusing it here
    // left #191 unreachable — every one-time annual licence on inite.ai was
    // answered 400 at checkout. A price without a period on a subscription
    // product still has to be bought as a subscription.
    if (dto.mode === 'PAYMENT' && product.type === 'subscription' && !price.interval) {
      throw new BadRequestException(
        `Product ${product.code} is a subscription product, use SUBSCRIPTION mode`,
      );
    }

    // A product sold per item (a chapter, an episode): the selling service
    // names the item, never the buyer, and it must fit the product's patterns.
    let item: Record<string, string> | undefined;
    const template = itemTemplate(product);
    if (template) {
      if (!callerServiceId) {
        throw new BadRequestException(
          `Product ${product.code} is sold per item; its site opens the checkout`,
        );
      }
      item = checkItem(template, (dto.metadata as Record<string, unknown> | undefined)?.item);
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
    const link = newCheckoutLink();
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
          ...(item ? { item } : {}),
          capturedAt: new Date().toISOString(),
        },
        metadata: {
          ...dto.metadata,
          ...(item ? { item } : {}),
          referralCode: dto.referralCode,
          successUrl: dto.successUrl,
          errorUrl: dto.errorUrl,
          linkTokenHash: link.hash,
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
      checkoutUrl: `${checkoutPageUrl(frontendUrl, order.id, dto.locale)}#t=${link.token}`,
    };

    // Store for idempotency
    if (idemKey) {
      await this.idempotencySet(idemKey, response);
    }

    return response;
  }

  /**
   * A cart: several of a service's own catalogue prices, each with a
   * quantity, paid as one order on any rail.
   *
   * Billing stays the price authority: the selling service names price codes
   * and quantities, never an amount. The order carries the first line's price
   * (for its product, its service and its routing), the summed amount, and the
   * lines in its snapshot. A cart grants nothing: a product with entitlements,
   * credits or per-item rules, or a subscription, cannot be put in one, so the
   * orchestrator's grants (which read the order's one price) never under- or
   * over-grant. Promo codes do not apply to a cart (paySession refuses).
   */
  async createCartSession(
    userId: string,
    input: CartSessionInput,
    idempotencyKey: string,
    callerServiceId: string,
  ): Promise<CheckoutSessionResponseDto & { amount: string; currency: string }> {
    const idemKey = `checkout:cart:${userId}:${idempotencyKey}`;
    const claim = await this.idempotencyClaim(idemKey);
    if (claim.kind === 'completed') {
      return claim.value as CheckoutSessionResponseDto & { amount: string; currency: string };
    }
    if (claim.kind === 'in_flight') {
      throw new ConflictException('A checkout with this idempotency key is already being created');
    }
    try {
      const response = await this.buildCartSession(userId, input, callerServiceId);
      await this.idempotencySet(idemKey, response);
      return response;
    } catch (error) {
      await this.idempotencyRelease(idemKey);
      throw error;
    }
  }

  private async buildCartSession(
    userId: string,
    input: CartSessionInput,
    callerServiceId: string,
  ): Promise<CheckoutSessionResponseDto & { amount: string; currency: string }> {
    const lines = input.lines ?? [];
    if (lines.length === 0 || lines.length > CART_MAX_LINES) {
      throw new BadRequestException(`A cart has 1 to ${CART_MAX_LINES} lines`);
    }
    const seen = new Set<string>();
    const priced: Array<{
      price: Awaited<ReturnType<CatalogService['getPriceByCode']>>;
      quantity: number;
    }> = [];
    for (const line of lines) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > CART_MAX_QTY) {
        throw new BadRequestException(`A cart line's quantity is 1 to ${CART_MAX_QTY}`);
      }
      if (seen.has(line.priceCode)) {
        throw new BadRequestException(`Price ${line.priceCode} is in the cart twice`);
      }
      seen.add(line.priceCode);
      const price = await this.catalogService.getPriceByCode(line.priceCode);
      const product = price.product;
      // Another service's price reads as unknown, as in createSession.
      if (!product || product.serviceId !== callerServiceId) {
        throw new NotFoundException(`Price not found: ${line.priceCode}`);
      }
      if (!product.isActive) {
        throw new BadRequestException(`Product ${product.code} is not active`);
      }
      if (product.type === 'subscription' || price.interval) {
        throw new BadRequestException(`Product ${product.code} cannot be sold in a cart`);
      }
      const meta = (product.metadata as Record<string, any>) || {};
      if (
        itemTemplate(product) ||
        meta.entitlements ||
        meta.entitlementKey ||
        meta.credits ||
        meta.creditsPerPeriod ||
        meta.commitment
      ) {
        throw new BadRequestException(
          `Product ${product.code} grants access and cannot be sold in a cart`,
        );
      }
      priced.push({ price, quantity: line.quantity });
    }
    const currency = String(priced[0].price.currency).toUpperCase();
    if (priced.some((p) => String(p.price.currency).toUpperCase() !== currency)) {
      throw new BadRequestException('Every price in a cart has the same currency');
    }
    const amount = roundMoney(
      priced.reduce((sum, p) => sum.plus(toMoney(p.price.amount).mul(p.quantity)), toMoney(0)),
    );
    if (amount.lte(0)) {
      throw new BadRequestException('A cart must cost something');
    }

    const first = priced[0].price;
    const items = priced.map((p) => ({
      priceCode: p.price.code,
      productCode: p.price.product.code,
      productName: p.price.product.name,
      quantity: p.quantity,
      unitAmount: toMoney(p.price.amount).toFixed(2),
      lineAmount: roundMoney(toMoney(p.price.amount).mul(p.quantity)).toFixed(2),
    }));
    const link = newCheckoutLink();
    const order = await this.prisma.order.create({
      data: {
        userId,
        priceId: first.id,
        mode: 'PAYMENT',
        status: 'created',
        amount,
        currency: first.currency,
        externalId: `order_${randomUUID()}`,
        snapshot: {
          priceCode: first.code,
          priceAmount: first.amount.toString(),
          currency: first.currency,
          interval: null,
          trialDays: null,
          productCode: first.product.code,
          productName: first.product.name,
          productType: first.product.type,
          serviceId: first.product.serviceId ?? null,
          cart: items,
          capturedAt: new Date().toISOString(),
        },
        metadata: {
          ...(input.metadata ?? {}),
          cart: items,
          successUrl: input.successUrl,
          errorUrl: input.errorUrl,
          linkTokenHash: link.hash,
        },
      },
    });

    this.funnelService.track({
      userId,
      eventType: 'checkout_started',
      stage: 'checkout',
      orderId: order.id,
      productId: first.productId,
      serviceId: first.product.serviceId ?? undefined,
      amount: moneyToNumber(amount),
      currency: order.currency,
      properties: { priceCode: first.code, cartLines: items.length },
    });

    const frontendUrl = resolveFrontendUrl(this.configService);
    return {
      sessionId: order.id,
      checkoutUrl: `${checkoutPageUrl(frontendUrl, order.id, input.locale)}#t=${link.token}`,
      amount: amount.toFixed(2),
      currency: String(order.currency),
    };
  }

  /**
   * An open line: one item a service prices and names itself, sold through
   * one of its open products (see open-product.ts). The service names the
   * amount, currency, title and ref; billing checks them against the
   * product's bounds, the service's daily cap and the rails' minimums, keeps
   * them on the order, and on payment grants the product's template with the
   * ref put in (or nothing, for goods the service fulfils from its webhook).
   * Every attempt is audited, refused ones with the reason.
   */
  async createOpenSession(
    userId: string,
    input: OpenSessionInput,
    idempotencyKey: string,
    caller: { serviceId: string; serviceCode: string; clientId?: string | null },
  ): Promise<OpenSessionResponse> {
    if (!this.openPolicy) throw new BadRequestException('Open products are not sold here');
    const idemKey = `checkout:open:${caller.serviceId}:${userId}:${idempotencyKey}`;
    const claim = await this.idempotencyClaim(idemKey);
    if (claim.kind === 'completed') return claim.value as OpenSessionResponse;
    if (claim.kind === 'in_flight') {
      throw new ConflictException('A checkout with this idempotency key is already being created');
    }
    try {
      const response = await this.buildOpenSession(userId, input, caller);
      await this.idempotencySet(idemKey, response);
      return response;
    } catch (error) {
      await this.idempotencyRelease(idemKey);
      const line = input.line;
      await this.openPolicy.audit({
        serviceId: caller.serviceId,
        clientId: caller.clientId,
        productCode: String(line.productCode ?? ''),
        userId,
        outcome: 'refused',
        reason: (error as Error)?.message ?? 'refused',
        currency: typeof line.currency === 'string' ? line.currency.slice(0, 10) : null,
        quantity: Number.isInteger(line.quantity) ? line.quantity : null,
        ref: typeof line.ref === 'string' && SAFE_REF.test(line.ref) ? line.ref : null,
      });
      throw error;
    }
  }

  private async buildOpenSession(
    userId: string,
    input: OpenSessionInput,
    caller: { serviceId: string; serviceCode: string; clientId?: string | null },
  ): Promise<OpenSessionResponse> {
    const line = input.line;
    const product = await this.prisma.product.findUnique({
      where: { code: String(line.productCode) },
      include: { service: true },
    });
    // Another service's product reads as unknown, as a price does.
    if (!product || product.serviceId !== caller.serviceId || !product.service) {
      throw new NotFoundException(`Product not found: ${line.productCode}`);
    }
    if (!product.isActive) throw new BadRequestException(`Product ${product.code} is not active`);
    const config = openConfig(product, caller.serviceCode);

    const currency = String(line.currency ?? '').toUpperCase();
    const unit = parseOpenAmount(line.amount);
    checkBounds(unit, currency, config);
    const title = sanitizeTitle(line.title);
    const ref = checkRef(line.ref, config);
    const quantity = line.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > CART_MAX_QTY) {
      throw new BadRequestException(`An open line's quantity is 1 to ${CART_MAX_QTY}`);
    }
    const entitlementKey = openEntitlementKey(config, ref);
    // Access is granted once, whatever the quantity: one of it is all one can buy.
    if (entitlementKey && quantity !== 1) {
      throw new BadRequestException('A line that grants access is bought once (quantity 1)');
    }
    const amount = roundMoney(unit.mul(quantity));

    await this.openPolicy!.assertWithinCap(product.service, currency, amount);
    const rails = await this.openPolicy!.eligibleRails(currency, amount);
    if (rails.length === 0) {
      throw new UnprocessableEntityException(
        `No payment method takes ${amount.toFixed(2)} ${currency}: it is below every provider's minimum`,
      );
    }

    // The order hangs on one internal price per product and currency, amount
    // 0, never sold by its code (CatalogService.getPriceByCode refuses it).
    const priceCode = openPriceCode(product.code, currency);
    if (priceCode.length > 100) {
      throw new BadRequestException(`Product code ${product.code} is too long to sell open`);
    }
    const price = await this.prisma.price.upsert({
      where: { code: priceCode },
      create: {
        productId: product.id,
        code: priceCode,
        currency,
        amount: 0,
        metadata: { open: true },
      },
      update: {},
    });
    if (price.productId !== product.id || !price.isActive) {
      throw new BadRequestException(`Product ${product.code} is not sold in ${currency} now`);
    }

    const item = {
      priceCode,
      productCode: product.code,
      productName: title,
      quantity,
      unitAmount: unit.toFixed(2),
      lineAmount: amount.toFixed(2),
      ref,
    };
    const open = { ...item, title, entitlementKey };
    const link = newCheckoutLink();
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId,
          priceId: price.id,
          mode: 'PAYMENT',
          status: 'created',
          amount,
          currency,
          externalId: `order_${randomUUID()}`,
          snapshot: {
            priceCode,
            priceAmount: amount.toString(),
            currency,
            interval: null,
            trialDays: null,
            productCode: product.code,
            productName: title,
            productType: 'open',
            serviceId: product.serviceId,
            open,
            cart: [item],
            capturedAt: new Date().toISOString(),
          },
          metadata: {
            ...(input.metadata ?? {}),
            open,
            cart: [item],
            // The per-item grant the orchestrator already makes on payment.
            ...(entitlementKey ? { item: { ref } } : { item: null }),
            successUrl: input.successUrl,
            errorUrl: input.errorUrl,
            linkTokenHash: link.hash,
          },
        },
      });
      await tx.openSaleAudit.create({
        data: {
          serviceId: caller.serviceId,
          clientId: caller.clientId ?? null,
          productCode: product.code,
          orderId: created.id,
          userId,
          outcome: 'opened',
          amount,
          currency,
          quantity,
          title,
          ref,
          entitlementKey,
        },
      });
      return created;
    });

    this.funnelService.track({
      userId,
      eventType: 'checkout_started',
      stage: 'checkout',
      orderId: order.id,
      productId: product.id,
      serviceId: product.serviceId ?? undefined,
      amount: moneyToNumber(amount),
      currency,
      properties: { priceCode, open: true },
    });

    const frontendUrl = resolveFrontendUrl(this.configService);
    return {
      sessionId: order.id,
      checkoutUrl: `${checkoutPageUrl(frontendUrl, order.id, input.locale)}#t=${link.token}`,
      amount: amount.toFixed(2),
      currency,
      rails,
      ...(entitlementKey ? { entitlementKey } : {}),
    };
  }

  /**
   * Get session details for the checkout page.
   * Returns order info, product, price, and available payment methods.
   */
  async getSession(
    sessionId: string,
    userId?: string,
    callerServiceId?: string,
    /** The token from the checkout link: opens the order without a session. */
    linkToken?: string,
  ) {
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

    if (linkToken) {
      this.assertLink(order, linkToken);
    } else if (userId && order.userId !== userId) {
      // A signed-in user: their own order — or a guest order they are the
      // first to open.
      order.userId = await this.claimGuestOrder(order, userId);
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
      const currency = String(order.currency).toUpperCase();
      // A currency the rail cannot take natively is still offered when it can
      // convert it and the admin ticked that currency on the provider.
      const converted =
        !!capabilities?.convertsTo?.length &&
        provider.currencies.map((c) => c.toUpperCase()).includes(currency);
      if (
        capabilities?.currencies?.length &&
        !capabilities.currencies.includes(currency) &&
        !converted
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
    // An open product's amount is the seller's: a rail whose provider minimum
    // it does not meet is not offered (fixed prices are left as they were).
    if (order.price.product.type === 'open' && this.openPolicy) {
      const eligible = new Set(
        await this.openPolicy.eligibleRails(order.currency, toMoney(order.amount)),
      );
      for (let i = paymentMethods.length - 1; i >= 0; i--) {
        if (!eligible.has(paymentMethods[i].code)) paymentMethods.splice(i, 1);
      }
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
        /** Name/description per language; the page picks its own (metadata.i18n). */
        i18n: productTranslations(order.price.product.metadata),
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
      // A cart's lines, for the page to list (createCartSession).
      ...(Array.isArray(metadata.cart)
        ? {
            items: metadata.cart.map((l: Record<string, unknown>) => ({
              productName: String(l.productName ?? ''),
              quantity: Number(l.quantity ?? 1),
              lineAmount: String(l.lineAmount ?? ''),
            })),
          }
        : {}),
    };
  }

  /**
   * A service that sells without accounts (mikefluff.com) opens a checkout
   * for a namespaced guest id — `mikefluff:<hex>` — that no INITE user has.
   * The hosted checkout page makes the buyer sign in, and the order then
   * belongs to someone else, so every guest purchase stopped at "session not
   * found". The first signed-in user to open such an order takes it, as long
   * as nothing has happened to it yet: still `created`, no payment started.
   * The guest id stays in `metadata.guestUserId` for the selling service,
   * which reconciles by order id. An order owned by a real user is never
   * claimable. Returns the user id the order now belongs to; throws
   * Forbidden when it cannot be claimed.
   */
  private async claimGuestOrder(
    order: { id: string; userId: string; status: string; metadata: unknown },
    userId: string,
  ): Promise<string> {
    const forbidden = () => {
      // Which two ids disagreed: without this a buyer's "session not found"
      // left nothing on the server to explain it. DIDs are pseudonymous.
      this.logger.warn(
        `Checkout ${order.id} denied: owner ${order.userId.slice(0, 20)} requester ${userId.slice(0, 20)} status ${order.status}`,
      );
      return new ForbiddenException('You do not have access to this session');
    };
    const guestId = order.userId;
    if (!isGuestUserId(guestId) || isGuestUserId(userId) || order.status !== 'created') {
      throw forbidden();
    }
    const intents = await this.prisma.paymentIntent.count({ where: { orderId: order.id } });
    if (intents > 0) throw forbidden();

    const metadata = {
      ...((order.metadata as Record<string, any>) || {}),
      guestUserId: guestId,
      claimedAt: new Date().toISOString(),
    };
    // Conditional on the guest still owning it and it still being `created`:
    // two users opening the same link at once — one of them gets it.
    const claimed = await this.prisma.order.updateMany({
      where: { id: order.id, userId: guestId, status: 'created' },
      data: { userId, metadata },
    });
    if (claimed.count !== 1) {
      // Lost a race. Fine if the winner was this same user (two tabs).
      const now = await this.prisma.order.findUnique({
        where: { id: order.id },
        select: { userId: true, metadata: true },
      });
      if (now?.userId !== userId) throw forbidden();
      order.metadata = now.metadata;
      return userId;
    }
    this.logger.log(`Guest order ${order.id} claimed: ${guestId} -> ${userId}`);
    order.metadata = metadata;
    return userId;
  }

  /**
   * Phase 2: Initiate payment for a checkout session.
   * Validates promo code, applies discount, creates PaymentIntent.
   * If amount is 0 (100% discount), fulfills immediately and returns successUrl.
   */
  async paySession(
    sessionId: string,
    userId: string | undefined,
    data: {
      rail?: string;
      promoCode?: string;
      cryptoChain?: string;
      cryptoToken?: string;
      method?: string;
    },
    buyerEmail?: string,
    linkToken?: string,
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

    // Paid through the link, the order stays with the buyer the store opened
    // it for: their DID for a signed-in store, the store's guest id otherwise.
    if (linkToken) {
      this.assertLink(order, linkToken);
      userId = order.userId;
    } else if (!userId) {
      throw new UnauthorizedException('Authentication required');
    } else if (order.userId !== userId) {
      order.userId = await this.claimGuestOrder(order, userId);
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
    // A promo code is checked against one price; a cart is several.
    if (data.promoCode && Array.isArray(metadata.cart)) {
      throw new BadRequestException('A promo code does not apply to a cart');
    }
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
    const open = product.type === 'open';
    if (open && !this.openPolicy) {
      throw new BadRequestException('Open products are not sold here');
    }
    if (data.rail) {
      rail = data.rail;
    } else if (open) {
      const [first] = await this.openPolicy!.eligibleRails(order.currency, orderAmountDecimal);
      if (!first) {
        throw new BadRequestException('No payment method takes an amount this small');
      }
      rail = first;
    } else {
      const activeProvider = await this.prisma.paymentProvider.findFirst({
        where: { isActive: true },
      });
      if (!activeProvider) {
        throw new BadRequestException('No payment providers are configured.');
      }
      rail = activeProvider.code;
    }

    if (open) {
      // The minimum the checkout page applied, enforced: a rail named directly
      // is held to it too. Then the service's day, counting this order once.
      if (!(await this.openPolicy!.railTakes(rail, order.currency, orderAmountDecimal))) {
        throw new BadRequestException(
          `${rail} does not take ${orderAmountDecimal.toFixed(2)} ${order.currency}; choose another payment method`,
        );
      }
      const service = product.serviceId
        ? await this.prisma.service.findUnique({ where: { id: product.serviceId } })
        : null;
      if (!service) throw new BadRequestException('This open product has no service');
      await this.openPolicy!.assertWithinCap(service, order.currency, orderAmountDecimal, order.id);
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

    // Create payment intent with adapter. A provider refusal used to leave no
    // trace but the buyer's error message: record it, then rethrow unchanged.
    let intentResult: Awaited<ReturnType<Connector['createPaymentIntent']>>;
    try {
      intentResult = await adapter.createPaymentIntent(intentInput);
    } catch (error) {
      await this.recordProviderFailure(error, {
        orderId: order.id,
        priceCode: price.code,
        rail,
        method: data.method,
        amount: orderAmountDecimal,
        currency: price.currency,
      });
      throw error;
    }
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
  async refreshPayment(sessionId: string, userId: string | undefined, linkToken?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: sessionId } });
    if (!order) throw new NotFoundException('Checkout session not found');
    if (linkToken) {
      this.assertLink(order, linkToken);
    } else if (!userId) {
      throw new UnauthorizedException('Authentication required');
    } else if (order.userId !== userId) {
      order.userId = await this.claimGuestOrder(order, userId);
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
    return linkToken
      ? this.getSession(sessionId, undefined, undefined, linkToken)
      : this.getSession(sessionId, userId);
  }

  /**
   * A promo code checked against this session's price, for its buyer: what the
   * checkout page asks before paying. Works through the link like the rest of
   * the session; a signed-in user must own the order.
   */
  async validateSessionPromo(
    sessionId: string,
    promoCode: string,
    userId: string | undefined,
    linkToken?: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: sessionId } });
    if (!order) throw new NotFoundException('Checkout session not found');
    if (linkToken) {
      this.assertLink(order, linkToken);
    } else if (!userId) {
      throw new UnauthorizedException('Authentication required');
    } else if (order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this session');
    }
    return this.promoCodesService.validatePromoCode(promoCode, order.priceId, order.userId);
  }

  /** Throws the same "not found" as a missing order: a wrong token says nothing. */
  private assertLink(order: { id: string; metadata: unknown }, token: string): void {
    if (!checkoutLinkMatches(order.metadata, token)) {
      this.logger.warn(`Checkout ${order.id} denied: link token does not match`);
      throw new NotFoundException('Checkout session not found');
    }
  }

  /**
   * A provider refused to start a payment: log it and keep a `failed` intent
   * with the provider's (redacted) message and code in `snapshot.providerError`.
   * The intent goes straight to the DB, not through the orchestrator — a
   * failed transition there fails the order, and the buyer can still retry
   * with another method. Never throws: the caller rethrows the provider error.
   */
  private async recordProviderFailure(
    error: unknown,
    ctx: {
      orderId: string;
      priceCode: string;
      rail: string;
      method?: string;
      amount: ReturnType<typeof toMoney>;
      currency: string;
    },
  ): Promise<void> {
    const providerError = summarizeProviderError(error);
    this.logger.error(
      `Payment provider ${ctx.rail}${ctx.method ? `/${ctx.method}` : ''} failed to create intent ` +
        `for order ${ctx.orderId} (price ${ctx.priceCode}, ${ctx.amount.toString()} ${ctx.currency}): ` +
        `${providerError.message}${providerError.code ? ` [code ${providerError.code}]` : ''}`,
    );
    try {
      await this.prisma.paymentIntent.create({
        data: {
          orderId: ctx.orderId,
          rail: ctx.rail,
          status: 'failed',
          method: ctx.method ?? null,
          amount: ctx.amount,
          currency: ctx.currency,
          snapshot: {
            providerError: { ...providerError, at: new Date().toISOString() },
          },
        },
      });
    } catch (persistError: any) {
      this.logger.warn(
        `Could not record failed payment intent for order ${ctx.orderId}: ${persistError?.message}`,
      );
    }
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

/** Languages the hosted checkout page has messages for (frontend/i18n/locales.ts). */
const CHECKOUT_LOCALES = ['en', 'ru', 'pt', 'es'];

/** The hosted checkout page, opened in the buyer's language when one is given and supported. */
export function checkoutPageUrl(frontendUrl: string, orderId: string, locale?: string): string {
  const url = `${frontendUrl}/checkout/${orderId}`;
  const lang = locale?.trim().toLowerCase().split(/[-_]/)[0];
  return lang && CHECKOUT_LOCALES.includes(lang) ? `${url}?locale=${lang}` : url;
}

/**
 * A user id a selling service made up for a buyer without an account:
 * namespaced, `<service>:<id>`. INITE user ids are uuids and never contain a
 * colon.
 */
export function isGuestUserId(userId: string | null | undefined): boolean {
  // INITE accounts are DIDs (`did:key:...`), which contain colons too. Only a
  // service namespace (`mikefluff:<hex>`) marks a guest; without this every
  // unpaid order of a real user was claimable by whoever opened its link.
  // An organisation (`org:<uuid>`) is no guest either: its plan would move to
  // the person who opened the page.
  return (
    typeof userId === 'string' &&
    userId.includes(':') &&
    !userId.startsWith('did:') &&
    !isOrgSubscriber(userId)
  );
}

/** The most lines and the most of one line a cart may hold. */
export const CART_MAX_LINES = 20;
export const CART_MAX_QTY = 99;

/** One open line, as the service sent it (checked in createOpenSession). */
export interface OpenLineInput {
  productCode: string;
  amount: string;
  currency: string;
  title: string;
  ref: string;
  quantity?: number;
}

export interface OpenSessionInput {
  line: OpenLineInput;
  successUrl: string;
  errorUrl: string;
  metadata?: Record<string, unknown>;
  locale?: string;
}

export interface OpenSessionResponse extends CheckoutSessionResponseDto {
  amount: string;
  currency: string;
  /** The rails that can take this amount; a provider whose minimum it misses is left out. */
  rails: string[];
  /** What payment grants, when the product grants anything. */
  entitlementKey?: string;
}

export interface CartSessionInput {
  lines: Array<{ priceCode: string; quantity: number }>;
  successUrl: string;
  errorUrl: string;
  metadata?: Record<string, unknown>;
  locale?: string;
}
