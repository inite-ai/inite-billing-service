import { CheckoutService } from '../src/checkout/checkout.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

// Stable UUID mock
jest.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

describe('CheckoutService', () => {
  let service: CheckoutService;
  let mockPrisma: any;
  let mockCatalog: any;
  let mockPaymentOrchestrator: any;
  let mockAffiliates: any;
  let mockPromoCodes: any;
  let mockFunnel: any;
  let mockConfig: any;

  const decimal = (v: number) =>
    Object.assign(Object.create(null), {
      valueOf: () => v,
      toString: () => String(v),
    });

  const mockProduct = {
    id: 'prod-1',
    code: 'pro-plan',
    name: 'Pro Plan',
    type: 'subscription',
    isActive: true,
    serviceId: 'svc-1',
    metadata: { description: 'Pro subscription' },
  };

  const mockPrice = {
    id: 'price-1',
    code: 'pro-monthly',
    amount: decimal(1000),
    currency: 'USD',
    interval: 'month',
    productId: 'prod-1',
    product: mockProduct,
  };

  const mockOrder = {
    id: 'order-1',
    userId: 'user-1',
    priceId: 'price-1',
    mode: 'SUBSCRIPTION',
    status: 'created',
    amount: decimal(1000),
    currency: 'USD',
    externalId: 'order_test-uuid-1234',
    metadata: { successUrl: 'https://ok.com', errorUrl: 'https://err.com' },
    price: mockPrice,
  };

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn((cb: any) => cb(mockPrisma)),
      order: {
        create: jest.fn().mockResolvedValue(mockOrder),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      paymentProvider: {
        findMany: jest.fn().mockResolvedValue([
          {
            code: 'STRIPE',
            name: 'Stripe',
            supportedModes: ['SUBSCRIPTION'],
            currencies: ['USD'],
          },
        ]),
        findFirst: jest.fn(),
      },
      paymentIntent: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      promoCode: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      promoCodeUsage: {
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    mockCatalog = {
      getPriceByCode: jest.fn().mockResolvedValue(mockPrice),
    };

    mockPaymentOrchestrator = {
      applyStateTransition: jest.fn(),
      getAdapter: jest.fn(),
    };

    mockAffiliates = {
      getAffiliateByCode: jest.fn().mockResolvedValue(null),
      trackReferral: jest.fn(),
    };

    mockPromoCodes = {
      validatePromoCode: jest.fn(),
      applyPromoCode: jest.fn(),
    };

    mockFunnel = {
      track: jest.fn(),
    };

    mockConfig = {
      get: jest.fn().mockReturnValue('https://billing.test'),
    };

    service = new CheckoutService(
      mockPrisma,
      mockCatalog,
      mockPaymentOrchestrator,
      mockAffiliates,
      mockPromoCodes,
      mockFunnel,
      mockConfig,
    );
  });

  // --- createSession() ---

  it('createSession() creates order with status created and returns sessionId + checkoutUrl', async () => {
    const result = await service.createSession('user-1', {
      priceCode: 'pro-monthly',
      mode: 'SUBSCRIPTION' as any,
    });

    expect(result.sessionId).toBe('order-1');
    expect(result.checkoutUrl).toBe('https://billing.test/checkout/order-1');
    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          status: 'created',
          mode: 'SUBSCRIPTION',
        }),
      }),
    );
    expect(mockFunnel.track).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'checkout_started' }),
    );
  });

  it('createSession() rejects inactive product', async () => {
    mockCatalog.getPriceByCode.mockResolvedValue({
      ...mockPrice,
      product: { ...mockProduct, isActive: false },
    });

    await expect(
      service.createSession('user-1', {
        priceCode: 'pro-monthly',
        mode: 'SUBSCRIPTION' as any,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('createSession() rejects mode mismatch (SUBSCRIPTION on one_time product)', async () => {
    mockCatalog.getPriceByCode.mockResolvedValue({
      ...mockPrice,
      product: { ...mockProduct, type: 'one_time' },
    });

    await expect(
      service.createSession('user-1', {
        priceCode: 'pro-monthly',
        mode: 'SUBSCRIPTION' as any,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // --- getSession() ---

  it('getSession() returns order details with payment methods', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

    const result = await service.getSession('order-1', 'user-1');

    expect(result.sessionId).toBe('order-1');
    expect(result.status).toBe('created');
    expect(result.product.code).toBe('pro-plan');
    expect(result.paymentMethods).toHaveLength(1);
    expect(result.paymentMethods[0].code).toBe('STRIPE');
  });

  it('getSession() throws ForbiddenException for wrong user', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

    await expect(service.getSession('order-1', 'other-user')).rejects.toThrow(ForbiddenException);
  });

  it('getSession() throws NotFoundException for missing session', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);

    await expect(service.getSession('missing-id', 'user-1')).rejects.toThrow(NotFoundException);
  });

  // --- paySession() ---

  it('paySession() with 0 amount (100% discount) creates paid intent and fulfills', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
    mockPromoCodes.validatePromoCode.mockResolvedValue({
      isValid: true,
      finalAmount: 0,
      discountAmount: 1000,
      promoCode: { id: 'promo-1' },
    });
    mockPrisma.order.update.mockResolvedValue({});
    mockPrisma.paymentIntent.create.mockResolvedValue({
      id: 'pi-1',
      status: 'created',
    });
    mockPaymentOrchestrator.applyStateTransition.mockResolvedValue({});

    const result = await service.paySession('order-1', 'user-1', {
      promoCode: 'FREE100',
    });

    expect(result.checkoutUrl).toBe('https://ok.com');
    expect(result.paymentIntentId).toBe('pi-1');
    expect(mockPrisma.paymentIntent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rail: 'PROMO',
          amount: 0,
        }),
      }),
    );
    expect(mockPaymentOrchestrator.applyStateTransition).toHaveBeenCalledWith('pi-1', 'paid');
  });

  it('paySession() reuses a live intent for the same rail instead of double-charging', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
    // A checkout URL was already issued for this order+rail (e.g. a double-click).
    mockPrisma.paymentIntent.findFirst.mockResolvedValue({
      id: 'existing-pi',
      rail: 'STRIPE',
      status: 'created',
      checkoutUrl: 'https://stripe/checkout/existing',
    });

    const result = await service.paySession('order-1', 'user-1', { rail: 'STRIPE' });

    expect(result).toEqual({
      checkoutUrl: 'https://stripe/checkout/existing',
      paymentIntentId: 'existing-pi',
    });
    // No new provider intent, no new DB row.
    expect(mockPaymentOrchestrator.getAdapter).not.toHaveBeenCalled();
    expect(mockPrisma.paymentIntent.create).not.toHaveBeenCalled();
    // The reuse query is scoped to non-terminal intents on this order + rail.
    expect(mockPrisma.paymentIntent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'order-1', rail: 'STRIPE', status: { in: ['created', 'opened'] } },
      }),
    );
  });

  it('paySession() rejects already-paid order', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      ...mockOrder,
      status: 'paid',
    });

    await expect(service.paySession('order-1', 'user-1', {})).rejects.toThrow(BadRequestException);
  });

  it('paySession() with invalid promo code throws BadRequestException', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
    mockPromoCodes.validatePromoCode.mockResolvedValue({
      isValid: false,
      error: 'Code expired',
    });

    await expect(service.paySession('order-1', 'user-1', { promoCode: 'EXPIRED' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
