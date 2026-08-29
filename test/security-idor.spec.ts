import { CheckoutService } from '../src/checkout/checkout.service';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { CreditsService } from '../src/credits/credits.service';
import { ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: () => 'test-uuid',
}));

/**
 * IDOR and authorization tests — verify that users cannot
 * access or modify resources belonging to other users.
 */
describe('IDOR — Checkout Session Access', () => {
  let service: CheckoutService;
  let mockPrisma: any;

  const decimal = (v: number) =>
    Object.assign(Object.create(null), {
      valueOf: () => v,
      toString: () => String(v),
    });

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn((cb: any) => cb(mockPrisma)),
      order: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      paymentProvider: { findMany: jest.fn().mockResolvedValue([]) },
      paymentIntent: { create: jest.fn() },
      promoCode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      promoCodeUsage: { create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    };

    service = new CheckoutService(
      mockPrisma,
      { getPriceByCode: jest.fn() } as any,
      { applyStateTransition: jest.fn(), getAdapter: jest.fn() } as any,
      { getAffiliateByCode: jest.fn(), trackReferral: jest.fn() } as any,
      { validatePromoCode: jest.fn() } as any,
      { track: jest.fn() } as any,
      { get: jest.fn().mockReturnValue('https://test.com') } as any,
    );
  });

  it('getSession() — user A cannot access user B order', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-B', // belongs to user B
      status: 'created',
      price: { product: {} },
      metadata: {},
    });

    await expect(
      service.getSession('order-1', 'user-A'), // user A tries to access
    ).rejects.toThrow(ForbiddenException);
  });

  it('paySession() — user A cannot pay user B order', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-B',
      status: 'created',
      amount: decimal(100),
      currency: 'USD',
      price: { id: 'p1', product: { serviceId: 's1' } },
      metadata: {},
    });

    await expect(service.paySession('order-1', 'user-A', {})).rejects.toThrow(ForbiddenException);
  });

  it('getSession() — undefined userId (service caller) bypasses ownership check', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-B',
      status: 'created',
      amount: decimal(100),
      currency: 'USD',
      price: {
        id: 'p1',
        code: 'plan',
        amount: decimal(100),
        currency: 'USD',
        interval: 'month',
        product: { id: 'prod', code: 'plan', name: 'Plan', type: 'subscription', serviceId: 's1' },
      },
      metadata: {},
    });
    mockPrisma.paymentProvider.findMany.mockResolvedValue([]);

    // Service callers pass userId=undefined
    const result = await service.getSession('order-1', undefined);
    expect(result.sessionId).toBe('order-1');
  });
});

describe('IDOR — Subscription Trial', () => {
  let service: SubscriptionsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn((cb: any) => cb(mockPrisma)),
      price: { findUnique: jest.fn() },
      subscription: { findFirst: jest.fn(), create: jest.fn() },
      entitlement: { create: jest.fn() },
    };

    service = new SubscriptionsService(
      mockPrisma,
      { emit: jest.fn() } as any,
      { grant: jest.fn() } as any,
      { track: jest.fn() } as any,
      { cancelProviderSubscription: jest.fn() } as any,
    );
  });

  it('service API key cannot trial a product from another service', async () => {
    mockPrisma.price.findUnique.mockResolvedValue({
      id: 'p1',
      code: 'plan-monthly',
      isActive: true,
      trialDays: 14,
      productId: 'prod-1',
      product: {
        id: 'prod-1',
        code: 'plan',
        name: 'Plan',
        serviceId: 'service-A', // belongs to service A
        metadata: {},
      },
    });

    // Service B tries to create trial for service A's product
    await expect(service.startTrial('user-1', 'plan-monthly', 'service-B')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('prevents duplicate trial for same product', async () => {
    mockPrisma.price.findUnique.mockResolvedValue({
      id: 'p1',
      code: 'plan-monthly',
      isActive: true,
      trialDays: 14,
      productId: 'prod-1',
      product: { id: 'prod-1', code: 'plan', name: 'Plan', serviceId: null, metadata: {} },
    });
    mockPrisma.subscription.findFirst.mockResolvedValueOnce({ id: 'sub-existing' }); // active sub exists

    await expect(service.startTrial('user-1', 'plan-monthly')).rejects.toThrow(ConflictException);
  });

  it('prevents re-trial after cancelled subscription', async () => {
    mockPrisma.price.findUnique.mockResolvedValue({
      id: 'p1',
      code: 'plan-monthly',
      isActive: true,
      trialDays: 14,
      productId: 'prod-1',
      product: { id: 'prod-1', code: 'plan', name: 'Plan', serviceId: null, metadata: {} },
    });
    mockPrisma.subscription.findFirst
      .mockResolvedValueOnce(null) // no active sub
      .mockResolvedValueOnce({ id: 'sub-past', status: 'canceled' }); // past trial exists

    await expect(service.startTrial('user-1', 'plan-monthly')).rejects.toThrow(ConflictException);
  });

  it('rejects price without trial days', async () => {
    mockPrisma.price.findUnique.mockResolvedValue({
      id: 'p1',
      code: 'no-trial',
      isActive: true,
      trialDays: 0,
      productId: 'prod-1',
      product: { id: 'prod-1', code: 'plan', name: 'Plan', serviceId: null, metadata: {} },
    });

    await expect(service.startTrial('user-1', 'no-trial')).rejects.toThrow(BadRequestException);
  });
});

describe('IDOR — Credits Consume', () => {
  let service: CreditsService;
  let mockPrisma: any;
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      // consume() acquires a SELECT … FOR UPDATE row lock on both paths.
      $queryRaw: jest.fn().mockResolvedValue([]),
      creditBalance: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      creditUsage: { create: jest.fn() },
    };

    mockPrisma = {
      $transaction: jest.fn((fn: any) => fn(mockTx)),
      creditBalance: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      creditUsage: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    };

    service = new CreditsService(mockPrisma);
  });

  it('negative admin adjust is blocked when exceeds balance', async () => {
    mockTx.creditBalance.findFirst.mockResolvedValue({
      id: 'bal-1',
      userId: 'user-1',
      serviceId: null,
      balance: 10,
      totalGranted: 10,
      totalUsed: 0,
    });

    await expect(
      service.adminAdjust({
        userId: 'user-1',
        amount: -50, // more than balance of 10
        description: 'correction',
      }),
    ).rejects.toThrow('negative balance');
  });

  it('consume of exactly 0 amount succeeds (no-op)', async () => {
    mockTx.creditBalance.findFirst.mockResolvedValue({
      id: 'bal-1',
      userId: 'user-1',
      serviceId: null,
      balance: 100,
      totalUsed: 0,
    });
    mockTx.creditBalance.update.mockResolvedValue({
      id: 'bal-1',
      balance: 100,
      totalUsed: 0,
    });

    // 0 amount should technically succeed (nothing consumed)
    const result = await service.consume({
      userId: 'user-1',
      amount: 0,
    });

    // balance >= 0, so it should succeed
    expect(result.success).toBe(true);
    expect(result.remainingBalance).toBe(100);
  });
});
