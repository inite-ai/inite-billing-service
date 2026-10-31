import { SubscriptionRenewalsService } from '../src/subscription-lifecycle/renewals.service';

/**
 * A plan paid by PIX or crypto renews by a link billing mails before the
 * period ends; one whose subscriber allowed the service on their INITE
 * wallet is charged there at period end, and gets the link only when the
 * wallet refuses (owner, 30.10.2026).
 */
describe('SubscriptionRenewalsService', () => {
  let prisma: any;
  let notifications: any;
  let merchants: any;
  let links: any;
  let service: SubscriptionRenewalsService;
  const NOW = new Date('2026-11-28T12:00:00Z');
  const env = process.env.SUBSCRIPTION_RENEWALS_ENABLED;

  const subscription = (over: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    userId: 'did:key:z6Mkbuyer',
    priceId: 'price-1',
    pendingPriceId: null,
    renewalOrderId: null,
    status: 'active',
    rail: 'HODLE',
    providerSubscriptionId: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date('2026-11-30T00:00:00Z'),
    price: {
      id: 'price-1',
      code: 'studio-pro-monthly-brl',
      amount: { toString: () => '199' },
      currency: 'BRL',
      interval: 'month',
      isActive: true,
      product: {
        code: 'studio-pro',
        name: 'Studio Pro',
        type: 'subscription',
        isActive: true,
        serviceId: 'svc-1',
        service: { id: 'svc-1', code: 'studio', name: 'Studio' },
      },
    },
    ...over,
  });

  beforeEach(() => {
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true';
    const orders = new Map<string, any>();
    prisma = {
      subscription: { findMany: jest.fn(), update: jest.fn() },
      price: { findUnique: jest.fn() },
      order: {
        findUnique: jest.fn(({ where }: any) =>
          where.id
            ? (orders.get(where.id) ?? null)
            : ([...orders.values()].find((o) => o.externalId === where.externalId) ?? null),
        ),
        create: jest.fn(({ data }: any) => {
          const order = { id: `order-${orders.size + 1}`, ...data };
          orders.set(order.id, order);
          return Promise.resolve(order);
        }),
        update: jest.fn(({ where, data }: any) => {
          Object.assign(orders.get(where.id), data);
        }),
      },
      wallet: { findUnique: jest.fn().mockResolvedValue(null) },
      walletMerchant: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    notifications = { notify: jest.fn() };
    merchants = { pay: jest.fn() };
    links = {
      reopen: jest.fn((id: string) => ({
        sessionId: id,
        checkoutUrl: `https://b/checkout/${id}#t=x`,
      })),
    };
    service = new SubscriptionRenewalsService(
      prisma,
      { runWithLock: (_k: string, _t: number, fn: () => Promise<void>) => fn() } as any,
      notifications,
      { getContact: jest.fn().mockResolvedValue({ locale: 'en' }) } as any,
      merchants,
      links,
      { get: () => 'https://billing.test' } as any,
    );
  });

  afterAll(() => {
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = env;
  });

  it('opens the next period as a one-off order and mails its link once', async () => {
    prisma.subscription.findMany.mockResolvedValue([subscription()]);
    await service.runSweep(NOW);

    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      mode: 'PAYMENT',
      priceId: 'price-1',
      currency: 'BRL',
      externalId: 'billing_renewal_sub-1_2026-11-30T00:00:00.000Z',
      metadata: {
        subscriptionRenewal: { subscriptionId: 'sub-1', periodEnd: '2026-11-30T00:00:00.000Z' },
      },
    });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { renewalOrderId: 'order-1' },
    });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({
      userId: 'did:key:z6Mkbuyer',
      type: 'dunning',
      metadata: { ctaUrl: 'https://b/checkout/order-1#t=x', orderId: 'order-1' },
    });

    // The next sweep finds the same order and does not mail again.
    prisma.subscription.findMany.mockResolvedValue([subscription({ renewalOrderId: 'order-1' })]);
    await service.runSweep(NOW);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('renews at the scheduled plan when a downgrade is waiting', async () => {
    prisma.subscription.findMany.mockResolvedValue([subscription({ pendingPriceId: 'price-0' })]);
    prisma.price.findUnique.mockResolvedValue({
      id: 'price-0',
      code: 'studio-starter-monthly-brl',
      amount: 75,
      currency: 'BRL',
      interval: 'month',
      isActive: true,
      product: { code: 'studio-starter', name: 'Starter', isActive: true, serviceId: 'svc-1' },
    });
    await service.runSweep(NOW);
    expect(prisma.order.create.mock.calls[0][0].data).toMatchObject({
      priceId: 'price-0',
      amount: 75,
    });
  });

  it('leaves alone what a provider renews, what is cancelled, and promos', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      subscription({ rail: 'LAVA', providerSubscriptionId: 'contract-1' }),
      subscription({ rail: 'PROMO' }),
    ]);
    await service.runSweep(NOW);
    expect(prisma.order.create).not.toHaveBeenCalled();
    // The query itself excludes cancelled plans and those with a provider.
    expect(prisma.subscription.findMany.mock.calls[0][0].where).toMatchObject({
      cancelAtPeriodEnd: false,
      providerSubscriptionId: null,
    });
  });

  it('charges an allowed wallet at period end, not before, and sends no link', async () => {
    prisma.wallet.findUnique.mockResolvedValue({ id: 'w-1', ownerKey: null });
    prisma.walletMerchant.findFirst.mockResolvedValue({ id: 'm-1' });
    prisma.subscription.findMany.mockResolvedValue([subscription({ rail: 'CRYPTO' })]);

    await service.runSweep(NOW);
    expect(merchants.pay).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();

    merchants.pay.mockResolvedValue({ status: 'confirming', orderId: 'order-1', txHash: '0x1' });
    prisma.subscription.findMany.mockResolvedValue([
      subscription({ rail: 'CRYPTO', renewalOrderId: 'order-1' }),
    ]);
    const atEnd = new Date('2026-11-30T00:30:00Z');
    await service.runSweep(atEnd);
    expect(merchants.pay).toHaveBeenCalledWith({
      ownerDid: 'did:key:z6Mkbuyer',
      orderId: 'order-1',
      serviceId: 'svc-1',
      serviceCode: 'studio',
    });
    expect(notifications.notify).not.toHaveBeenCalled();

    // One attempt per period: the next sweep does not charge again.
    await service.runSweep(atEnd);
    expect(merchants.pay).toHaveBeenCalledTimes(1);
  });

  it('sends the link when the wallet refuses', async () => {
    prisma.wallet.findUnique.mockResolvedValue({ id: 'w-1', ownerKey: null });
    prisma.walletMerchant.findFirst.mockResolvedValue({ id: 'm-1' });
    merchants.pay.mockResolvedValue({
      status: 'needs_approval',
      reason: 'over_limit',
      approveUrl: 'x',
    });
    prisma.subscription.findMany.mockResolvedValue([subscription({ rail: 'CRYPTO' })]);
    await service.runSweep(new Date('2026-11-30T00:30:00Z'));
    expect(merchants.pay).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('opens no renewal for a price no longer sold', async () => {
    const sub = subscription();
    sub.price.isActive = false;
    prisma.subscription.findMany.mockResolvedValue([sub]);
    await service.runSweep(NOW);
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('does nothing while switched off', async () => {
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'false';
    await service.sweep();
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
  });
});
