import { FunnelService } from '../src/funnel/funnel.service';

describe('FunnelService', () => {
  let service: FunnelService;
  let mockPrisma: any;

  const decimal = (v: number) =>
    Object.assign(Object.create(null), {
      valueOf: () => v,
      toString: () => String(v),
    });

  beforeEach(() => {
    mockPrisma = {
      funnelEvent: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
    };

    service = new FunnelService(mockPrisma);
  });

  // --- track() ---

  it('track() creates funnel event record', async () => {
    await service.track({
      userId: 'user-1',
      eventType: 'checkout_started',
      stage: 'checkout',
      orderId: 'order-1',
      amount: 100,
      currency: 'USD',
      properties: { priceCode: 'pro-monthly' },
    });

    expect(mockPrisma.funnelEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        eventType: 'checkout_started',
        stage: 'checkout',
        orderId: 'order-1',
        amount: 100,
        currency: 'USD',
        properties: { priceCode: 'pro-monthly' },
      }),
    });
  });

  // --- detectAbandonedCheckouts() ---

  it('detectAbandonedCheckouts() creates events for stale orders', async () => {
    const staleOrder = {
      id: 'order-stale',
      userId: 'user-1',
      status: 'created',
      amount: decimal(500),
      currency: 'USD',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
      price: {
        product: {
          id: 'prod-1',
          serviceId: 'svc-1',
        },
      },
    };

    mockPrisma.order.findMany.mockResolvedValue([staleOrder]);
    // No existing abandonment event
    mockPrisma.funnelEvent.findFirst.mockResolvedValue(null);

    const count = await service.detectAbandonedCheckouts();

    expect(count).toBe(1);
    expect(mockPrisma.funnelEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        eventType: 'checkout_abandoned',
        stage: 'churned',
        orderId: 'order-stale',
      }),
    });
  });

  it('detectAbandonedCheckouts() skips orders that already have abandonment events', async () => {
    const staleOrder = {
      id: 'order-stale',
      userId: 'user-1',
      status: 'created',
      amount: decimal(500),
      currency: 'USD',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      price: { product: { id: 'prod-1', serviceId: null } },
    };

    mockPrisma.order.findMany.mockResolvedValue([staleOrder]);
    // Already has abandonment event
    mockPrisma.funnelEvent.findFirst.mockResolvedValue({
      id: 'event-existing',
      eventType: 'checkout_abandoned',
    });

    const count = await service.detectAbandonedCheckouts();

    expect(count).toBe(0);
    // track() should not have been called (only the findFirst, no create)
    expect(mockPrisma.funnelEvent.create).not.toHaveBeenCalled();
  });

  // --- cleanupStaleOrders() ---

  it('cleanupStaleOrders() deletes old created orders without payment intents', async () => {
    mockPrisma.order.deleteMany.mockResolvedValue({ count: 3 });

    const count = await service.cleanupStaleOrders();

    expect(count).toBe(3);
    expect(mockPrisma.order.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: 'created',
        createdAt: { lt: expect.any(Date) },
        paymentIntents: { none: {} },
      }),
    });
  });

  // --- getFunnelMetrics() ---

  it('getFunnelMetrics() returns stage counts and conversion rates', async () => {
    mockPrisma.funnelEvent.groupBy.mockResolvedValue([
      { stage: 'checkout', _count: { id: 100 } },
      { stage: 'payment', _count: { id: 60 } },
      { stage: 'conversion', _count: { id: 40 } },
      { stage: 'churned', _count: { id: 10 } },
    ]);

    mockPrisma.funnelEvent.count
      .mockResolvedValueOnce(5) // abandoned checkouts
      .mockResolvedValueOnce(100) // checkout_started
      .mockResolvedValueOnce(40); // payment_completed

    const result = await service.getFunnelMetrics({});

    expect(result.totalEvents).toBe(210);
    expect(result.abandonedCheckouts).toBe(5);
    expect(result.conversionRate).toBe(40);

    // Verify stages array includes expected items
    const checkoutStage = result.stages.find((s) => s.stage === 'checkout');
    expect(checkoutStage).toBeDefined();
    expect(checkoutStage!.count).toBe(100);

    const paymentStage = result.stages.find((s) => s.stage === 'payment');
    expect(paymentStage).toBeDefined();
    expect(paymentStage!.count).toBe(60);
    // conversion rate for payment = 60/100 * 100 = 60
    expect(paymentStage!.conversionRate).toBe(60);
  });
});
