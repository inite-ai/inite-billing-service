import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly idempotencyStore: Map<string, CheckoutSessionResponseDto> =
    new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly paymentOrchestrator: PaymentOrchestratorService,
    private readonly affiliatesService: AffiliatesService,
    private readonly promoCodesService: PromoCodesService,
    private readonly funnelService: FunnelService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Phase 1: Create checkout session.
   * Creates an order with status 'created' but does NOT create a PaymentIntent.
   * Returns { sessionId, checkoutUrl } pointing to the billing frontend checkout page.
   */
  async createSession(
    userId: string,
    dto: CreateCheckoutSessionDto,
    idempotencyKey?: string,
  ): Promise<CheckoutSessionResponseDto> {
    // Idempotency check
    if (idempotencyKey) {
      const existing = this.idempotencyStore.get(
        `${userId}:${idempotencyKey}`,
      );
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
      throw new NotFoundException(
        `Product not found for price: ${dto.priceCode}`,
      );
    }

    // Reject checkout if the product is inactive
    if (!product.isActive) {
      throw new BadRequestException(`Product ${product.code} is not active`);
    }

    // Validate mode matches product type
    if (dto.mode === 'SUBSCRIPTION' && product.type !== 'subscription') {
      throw new BadRequestException(
        `Product ${product.code} is not a subscription product`,
      );
    }
    if (dto.mode === 'PAYMENT' && product.type === 'subscription') {
      throw new BadRequestException(
        `Product ${product.code} is a subscription product, use SUBSCRIPTION mode`,
      );
    }

    // Handle referral code if provided
    if (dto.referralCode) {
      const affiliate = await this.affiliatesService.getAffiliateByCode(
        dto.referralCode,
      );
      if (affiliate) {
        // Self-referral prevention
        if (affiliate.userId === userId) {
          this.logger.debug(`Self-referral blocked for user ${userId}`);
        } else {
          try {
            await this.affiliatesService.trackReferral(
              affiliate.id,
              userId,
              dto.referralCode,
            );
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

    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'https://billing.inite.ai';
    const response: CheckoutSessionResponseDto = {
      sessionId: order.id,
      checkoutUrl: `${frontendUrl}/checkout/${order.id}`,
    };

    // Store for idempotency
    if (idempotencyKey) {
      this.idempotencyStore.set(`${userId}:${idempotencyKey}`, response);
      setTimeout(() => {
        this.idempotencyStore.delete(`${userId}:${idempotencyKey}`);
      }, 3600000);
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
        description:
          (order.price.product.metadata as Record<string, any>)?.description ||
          null,
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
      throw new BadRequestException(
        `Order is in '${order.status}' status and cannot be paid`,
      );
    }

    const price = order.price;
    const product = price.product;
    const metadata = (order.metadata as Record<string, any>) || {};
    let orderAmount = Number(order.amount);
    const originalAmount = orderAmount;

    // Validate + apply promo code if provided
    let promoValidation: any = null;
    if (data.promoCode) {
      promoValidation = await this.promoCodesService.validatePromoCode(
        data.promoCode,
        price.id,
        userId,
      );

      if (!promoValidation.isValid) {
        throw new BadRequestException(
          `Invalid promo code: ${promoValidation.error}`,
        );
      }



      orderAmount = promoValidation.finalAmount;

      // Update order with discounted amount and promo metadata
      await this.prisma.order.update({
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

      // Record promo code usage
      await this.promoCodesService.applyPromoCode(
        promoValidation.promoCode.id,
        order.id,
        userId,
        originalAmount,
        promoValidation.discountAmount,
        promoValidation.finalAmount,
      );
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
      await this.paymentOrchestrator.applyStateTransition(
        paymentIntent.id,
        'paid',
      );

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

    // Create payment intent record
    const paymentIntent = await this.prisma.paymentIntent.create({
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

    return {
      checkoutUrl: intentResult.checkoutUrl || '',
      paymentIntentId: paymentIntent.id,
    };
  }
}
