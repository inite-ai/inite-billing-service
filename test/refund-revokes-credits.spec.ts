import { CreditsService } from '../src/credits/credits.service';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';

/**
 * Refunding an order used to hand the customer their money back *and* more
 * credits: the orchestrator called a method named `refund`, which incremented
 * the balance. Subscription grants were not stamped with an order id, so for
 * those the same path took back nothing at all, and the subscription itself
 * kept running with its entitlements active.
 *
 * These pin all three directions, because every one of them is a way to give
 * away paid product for free.
 */
describe('CreditsService.revokeGrant', () => {
  const balance = {
    id: 'bal-1',
    userId: 'user-1',
    serviceId: null,
    balance: 100,
    totalGranted: 100,
    totalUsed: 0,
  };

  const makeDb = (after: Partial<typeof balance> = {}) => ({
    creditBalance: {
      findUnique: jest.fn().mockResolvedValue(balance),
      create: jest.fn().mockResolvedValue(balance),
      update: jest.fn().mockResolvedValue({ ...balance, ...after }),
    },
    creditUsage: { create: jest.fn().mockResolvedValue({}) },
  });

  it('takes the credits away instead of adding them', async () => {
    const db = makeDb({ balance: 0, totalGranted: 0 });
    const service = new CreditsService({ $transaction: (fn: any) => fn(db) } as any);

    await service.revokeGrant({ userId: 'user-1', amount: 100, orderId: 'o1' });

    expect(db.creditBalance.update.mock.calls[0][0].data).toEqual({
      balance: { decrement: 100 },
      totalGranted: { decrement: 100 },
    });
  });

  it('writes the ledger row as a negative purchase reversal', async () => {
    const db = makeDb({ balance: 0 });
    const service = new CreditsService({ $transaction: (fn: any) => fn(db) } as any);

    await service.revokeGrant({ userId: 'user-1', amount: 100, orderId: 'o1' });

    // Positive here would sum as though credits had been handed out again.
    expect(db.creditUsage.create.mock.calls[0][0].data).toMatchObject({
      amount: -100,
      type: 'purchase_reversal',
      orderId: 'o1',
    });
  });

  it('lets the balance go negative when the credits were already spent', async () => {
    const db = makeDb({ balance: -40 });
    const service = new CreditsService({ $transaction: (fn: any) => fn(db) } as any);

    const updated = await service.revokeGrant({ userId: 'user-1', amount: 100, orderId: 'o1' });

    // The debt is the true state: consume() refuses to spend from it, so it has
    // to be settled before the customer can continue.
    expect(updated.balance).toBe(-40);
  });
});

describe('CreditsService.resetForPeriod', () => {
  it('stamps the order on the rows it writes, so a refund can find them', async () => {
    const db = {
      creditBalance: {
        findUnique: jest.fn().mockResolvedValue({ id: 'bal-1', balance: 30, serviceId: null }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'bal-1', balance: 500 }),
      },
      creditUsage: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new CreditsService({ $transaction: (fn: any) => fn(db) } as any);

    await service.resetForPeriod({
      userId: 'user-1',
      newBalance: 500,
      resetsAt: new Date('2026-09-01'),
      orderId: 'order-renewal',
    });

    const rows = db.creditUsage.create.mock.calls.map((c: any[]) => c[0].data);
    expect(rows.find((r: any) => r.type === 'reset')).toMatchObject({ orderId: 'order-renewal' });
    expect(rows.find((r: any) => r.type === 'grant')).toMatchObject({ orderId: 'order-renewal' });
  });
});

describe('order refund → credits and subscription', () => {
  const build = (overrides: { order?: any; grants?: any[]; subscription?: any } = {}) => {
    const order = {
      id: 'o1',
      userId: 'user-1',
      priceId: 'price-1',
      mode: 'PAYMENT',
      amount: '20.0000',
      currency: 'USD',
      ...overrides.order,
    };
    const grants = overrides.grants ?? [
      { userId: 'user-1', amount: 100, creditBalance: { serviceId: null } },
    ];

    const tx: any = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      invoice: { updateMany: jest.fn() },
      affiliateCommission: { updateMany: jest.fn() },
      creditUsage: {
        findMany: jest.fn().mockResolvedValue(grants),
        count: jest.fn().mockResolvedValue(0),
      },
      entitlement: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(overrides.subscription ?? null),
        // The event is addressed to the service that sold the plan, which is
        // read back through price → product.
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub-1',
          price: { product: { serviceId: 'svc-1' } },
        }),
        update: jest.fn(),
      },
    };

    const creditsService = { revokeGrant: jest.fn().mockResolvedValue({}) };
    const outboxService = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentOrchestratorService(
      {} as any, // prisma
      outboxService as any,
      {} as any, // affiliates
      { track: jest.fn() } as any, // funnel
      creditsService as any,
    );
    return { service, tx, creditsService, outboxService, order };
  };

  const refund = async (service: any, tx: any, id = 'o1') =>
    (service as any).handleOrderRefunded(id, tx);

  it('revokes every grant the order paid for', async () => {
    const { service, tx, creditsService } = build({
      grants: [
        { userId: 'user-1', amount: 100, creditBalance: { serviceId: null } },
        { userId: 'user-1', amount: 50, creditBalance: { serviceId: 'svc-1' } },
      ],
    });

    await refund(service, tx);

    expect(creditsService.revokeGrant).toHaveBeenCalledTimes(2);
    expect(creditsService.revokeGrant.mock.calls[0][0]).toMatchObject({
      amount: 100,
      orderId: 'o1',
    });
    expect(creditsService.revokeGrant.mock.calls[1][0]).toMatchObject({
      amount: 50,
      serviceId: 'svc-1',
    });
  });

  it('does not debit twice when a refund is replayed', async () => {
    const { service, tx, creditsService } = build();
    tx.creditUsage.count.mockResolvedValue(1); // a reversal already exists

    await refund(service, tx);

    expect(creditsService.revokeGrant).not.toHaveBeenCalled();
  });

  it('ends the subscription the refunded order was paying for', async () => {
    const { service, tx, outboxService } = build({
      order: { mode: 'SUBSCRIPTION' },
      subscription: { id: 'sub-1', userId: 'user-1', status: 'active' },
    });

    await refund(service, tx);

    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({ status: 'ended' }),
    });
    expect(outboxService.emit).toHaveBeenCalledWith(
      'billing.subscription.ended',
      expect.objectContaining({ subscription_id: 'sub-1', reason: 'payment_refunded' }),
      expect.objectContaining({ tx }),
    );
  });

  it('leaves a one-time order alone — there is no subscription to end', async () => {
    const { service, tx } = build();
    await refund(service, tx);
    expect(tx.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('does not resurrect a subscription that has already ended', async () => {
    const { service, tx, outboxService } = build({
      order: { mode: 'SUBSCRIPTION' },
      subscription: null,
    });

    await refund(service, tx);

    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(outboxService.emit).not.toHaveBeenCalledWith(
      'billing.subscription.ended',
      expect.anything(),
      expect.objectContaining({ tx }),
    );
  });
});
