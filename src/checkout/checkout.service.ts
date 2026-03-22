import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { FunnelService } from '../funnel/funnel.service';
import { CreateCheckoutSessionDto, CheckoutSessionResponseDto } from '../common/dto/checkout.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly idempotencyStore: Map<string, CheckoutSessionResponseDto> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly paymentOrchestrator: PaymentOrchestratorService,
    private readonly affiliatesService: AffiliatesService,
    private readonly promoCodesService: PromoCodesService,
    private readonly funnelService: FunnelService,
  ) {}

  async createCheckoutSession(
    userId: string,
    dto: CreateCheckoutSessionDto,
    idempotencyKey?: string,
  ): Promise<CheckoutSessionResponseDto> {
    // Idempotency check
    if (idempotencyKey) {
      const existing = this.idempotencyStore.get(`${userId}:${idempotencyKey}`);
      if (existing) {
        this.logger.debug(`Returning existing checkout session for idempotency key: ${idempotencyKey}`);
        return existing;
      }
    }

    // Get price (includes product via CatalogService)
    const price = await this.catalogService.getPriceByCode(dto.priceCode);
    const product = price.product;

    if (!product) {
      throw new NotFoundException(`Product not found for price: ${dto.priceCode}`);
    }

    // L1: Reject checkout if the product is inactive
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

    // Determine rail
    const rail = dto.rail || 'ONE';

    // Validate promo code if provided
    let promoValidation: any = null;
    let orderAmount = price.amount;
    let originalAmount = Number(price.amount);

    if (dto.promoCode) {
      promoValidation = await this.promoCodesService.validatePromoCode(
        dto.promoCode,
        price.id,
        userId,
      );

      if (!promoValidation.isValid) {
        throw new BadRequestException(
          `Invalid promo code: ${promoValidation.error}`,
        );
      }

      // Check stackWithReferral
      if (!promoValidation.promoCode.stackWithReferral && dto.referralCode) {
        throw new BadRequestException(
          'This promo code cannot be combined with a referral code',
        );
      }

      orderAmount = promoValidation.finalAmount;
    }

    // Handle referral code if provided
    if (dto.referralCode) {
      const affiliate = await this.affiliatesService.getAffiliateByCode(dto.referralCode);
      if (affiliate) {
        // Self-referral prevention (C3)
        if (affiliate.userId === userId) {
          this.logger.debug(`Self-referral blocked for user ${userId}`);
        } else {
          // Track referral if not already tracked
          try {
            await this.affiliatesService.trackReferral(
              affiliate.id,
              userId,
              dto.referralCode,
            );
          } catch (error: any) {
            // Referral might already exist, that's ok
            this.logger.debug(`Referral tracking: ${error.message}`);
          }
        }
      }
    }

    // Create order (amount is the discounted amount the user pays)
    const order = await this.prisma.order.create({
      data: {
        userId,
        priceId: price.id,
        mode: dto.mode,
        status: 'created',
        amount: orderAmount,
        currency: price.currency,
        externalId: `order_${uuidv4()}`,
        metadata: {
          ...dto.metadata,
          referralCode: dto.referralCode,
          ...(promoValidation
            ? {
                promoCode: dto.promoCode,
                promoCodeId: promoValidation.promoCode.id,
                originalAmount,
                discountAmount: promoValidation.discountAmount,
              }
            : {}),
        },
      },
    });

    // Record promo code usage after order creation
    if (promoValidation) {
      await this.promoCodesService.applyPromoCode(
        promoValidation.promoCode.id,
        order.id,
        userId,
        originalAmount,
        promoValidation.discountAmount,
        promoValidation.finalAmount,
      );
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
        rail,
        promoCode: dto.promoCode,
        referralCode: dto.referralCode,
      },
    });

    // Get adapter
    const adapter = this.paymentOrchestrator.getAdapter(rail);

    // Create payment intent with adapter (use discounted amount)
    const intentResult = await adapter.createPaymentIntent({
      orderId: order.externalId!,
      amount: Number(orderAmount),
      currency: price.currency,
      mode: dto.mode,
      successUrl: dto.successUrl,
      errorUrl: dto.errorUrl,
      metadata: {
        ...dto.metadata,
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
        amount: price.amount,
        currency: price.currency,
        expiresAt: intentResult.expiresAt,
        snapshot: intentResult.metadata || {},
      },
    });

    const response: CheckoutSessionResponseDto = {
      orderId: order.id,
      paymentIntentId: paymentIntent.id,
      checkoutUrl: intentResult.checkoutUrl || '',
    };

    // Store for idempotency
    if (idempotencyKey) {
      this.idempotencyStore.set(`${userId}:${idempotencyKey}`, response);
      // Cleanup after 1 hour (simple in-memory store - in production use Redis)
      setTimeout(() => {
        this.idempotencyStore.delete(`${userId}:${idempotencyKey}`);
      }, 3600000);
    }

    return response;
  }
}

