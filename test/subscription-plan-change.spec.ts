import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PlanChangeService } from '../src/subscription-lifecycle/plan-change.service';

/**
 * POST …/subscriptions/:id/change: the subscriber or the selling service moves
 * a plan within one service. Upgrades are paid as a one-off order for the
 * prorated difference; downgrades wait for the period end; provider-renewed
 * subscriptions are refused, because the provider keeps its own amount.
 */
describe('PlanChangeService', () => {
  let prisma: any;
  let outbox: any;
  let orchestrator: any;
  let links: any;
  let service: PlanChangeService;

  const svc = { id: 'svc-1', code: 'studio' };
  const price = (id: string, amount: number, over: Record<string, unknown> = {}) => ({
    id,
    code: `${id}-code`,
    amount,
    currency: 'USD',
    interval: 'month',
    isActive: true,
    product: {
      code: `${id}-product`,
      name: id,
      type: 'subscription',
      isActive: true,
      serviceId: 'svc-1',
      service: svc,
    },
    ...over,
  });
  const now = Date.now();
  const sub = (over: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    userId: 'did:key:z6Mkbuyer',
    priceId: 'starter',
    pendingPriceId: null,
    renewalOrderId: null,
    status: 'active',
    rail: 'HODLE',
    providerSubscriptionId: null,
    cancelAtPeriodEnd: false,
    currentPeriodStart: new Date(now - 15 * 86_400_000),
    currentPeriodEnd: new Date(now + 15 * 86_400_000),
    price: price('starter', 15),
    ...over,
  });

  beforeEach(() => {
    prisma = {
      subscription: { findUnique: jest.fn(), update: jest.fn() },
      price: { findUnique: jest.fn() },
      order: {
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'order-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      paymentIntent: { count: jest.fn().mockResolvedValue(0) },
    };
    outbox = { emit: jest.fn() };
    orchestrator = { changePlanWithoutPayment: jest.fn().mockResolvedValue(true) };
    links = { withX402: jest.fn().mockImplementation((s: any) => s) };
    const config = {
      get: (k: string) => (k === 'FRONTEND_URL' ? 'https://billing.test' : undefined),
    };
    service = new PlanChangeService(prisma, outbox, orchestrator, links, config as any);
  });

  it('charges the prorated difference of an upgrade as a one-off order', async () => {
    prisma.subscription.findUnique.mockResolvedValue(sub());
    prisma.price.findUnique.mockResolvedValue(price('pro', 39));
    const result = await service.change(
      { userId: 'did:key:z6Mkbuyer' },
      { subscriptionId: 'sub-1', priceCode: 'pro-code' },
    );
    expect(result).toMatchObject({ status: 'payment_required', amount: '12.00', currency: 'USD' });
    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.mode).toBe('PAYMENT');
    expect(data.priceId).toBe('pro');
    expect(data.amount.toFixed(2)).toBe('12.00');
    expect(data.metadata.planChange).toMatchObject({
      subscriptionId: 'sub-1',
      fromPriceId: 'starter',
      toPriceId: 'pro',
    });
    expect(data.metadata.linkTokenHash).toEqual(expect.any(String));
    expect((result as any).checkoutUrl).toMatch(/^https:\/\/billing\.test\/.*#t=/);
  });

  it('schedules a downgrade for the period end and tells the service', async () => {
    prisma.subscription.findUnique.mockResolvedValue(
      sub({ priceId: 'pro', price: price('pro', 39) }),
    );
    prisma.price.findUnique.mockResolvedValue(price('starter', 15));
    const result = await service.change(
      { serviceId: 'svc-1' },
      { subscriptionId: 'sub-1', priceCode: 'starter-code' },
    );
    expect(result).toMatchObject({ status: 'scheduled', priceCode: 'starter-code' });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { pendingPriceId: 'starter' },
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(outbox.emit).toHaveBeenCalledWith(
      'billing.subscription.plan_change_scheduled',
      expect.objectContaining({ to_price_id: 'starter' }),
      { serviceId: 'svc-1' },
    );
  });

  it('closes an untouched renewal order priced for the old plan', async () => {
    prisma.subscription.findUnique.mockResolvedValue(
      sub({ priceId: 'pro', price: price('pro', 39), renewalOrderId: 'renewal-1' }),
    );
    prisma.price.findUnique.mockResolvedValue(price('starter', 15));
    await service.change(
      { serviceId: 'svc-1' },
      { subscriptionId: 'sub-1', priceCode: 'starter-code' },
    );
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'renewal-1', status: 'created' },
      data: { status: 'expired' },
    });
  });

  it('waits while a renewal payment is under way', async () => {
    prisma.subscription.findUnique.mockResolvedValue(
      sub({ priceId: 'pro', price: price('pro', 39), renewalOrderId: 'renewal-1' }),
    );
    prisma.price.findUnique.mockResolvedValue(price('starter', 15));
    prisma.paymentIntent.count.mockResolvedValue(1);
    await expect(
      service.change(
        { serviceId: 'svc-1' },
        { subscriptionId: 'sub-1', priceCode: 'starter-code' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('changes a no-card trial at once, through the orchestrator', async () => {
    prisma.subscription.findUnique.mockResolvedValue(sub({ status: 'trialing', rail: null }));
    const pro = price('pro', 39);
    prisma.price.findUnique.mockResolvedValue(pro);
    const result = await service.change(
      { userId: 'did:key:z6Mkbuyer' },
      { subscriptionId: 'sub-1', priceCode: 'pro-code' },
    );
    expect(result).toMatchObject({ status: 'changed' });
    expect(orchestrator.changePlanWithoutPayment).toHaveBeenCalledWith('sub-1', pro);
  });

  it('refuses a subscription a provider renews', async () => {
    prisma.subscription.findUnique.mockResolvedValue(
      sub({ rail: 'LAVA', providerSubscriptionId: 'contract-1' }),
    );
    prisma.price.findUnique.mockResolvedValue(price('pro', 39));
    await expect(
      service.change(
        { userId: 'did:key:z6Mkbuyer' },
        { subscriptionId: 'sub-1', priceCode: 'pro-code' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hides another person’s or another service’s subscription', async () => {
    prisma.subscription.findUnique.mockResolvedValue(sub());
    await expect(
      service.change({ userId: 'did:key:z6Mkother' }, { subscriptionId: 'sub-1', priceCode: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.change({ serviceId: 'svc-2' }, { subscriptionId: 'sub-1', priceCode: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('moves only to an active subscription price of the same service and currency', async () => {
    prisma.subscription.findUnique.mockResolvedValue(sub());
    const foreign = price('pro', 39);
    foreign.product = { ...foreign.product, serviceId: 'svc-2' };
    prisma.price.findUnique.mockResolvedValueOnce(foreign);
    await expect(
      service.change({ serviceId: 'svc-1' }, { subscriptionId: 'sub-1', priceCode: 'pro-code' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.price.findUnique.mockResolvedValueOnce(price('pro', 199, { currency: 'BRL' }));
    await expect(
      service.change({ serviceId: 'svc-1' }, { subscriptionId: 'sub-1', priceCode: 'pro-code' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.price.findUnique.mockResolvedValueOnce(price('pro', 39, { interval: null }));
    await expect(
      service.change({ serviceId: 'svc-1' }, { subscriptionId: 'sub-1', priceCode: 'pro-code' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('asks for the unpaid renewal first, and for a resume of a cancelled plan', async () => {
    prisma.subscription.findUnique.mockResolvedValueOnce(sub({ status: 'past_due' }));
    await expect(
      service.change({ serviceId: 'svc-1' }, { subscriptionId: 'sub-1', priceCode: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
    prisma.subscription.findUnique.mockResolvedValueOnce(sub({ cancelAtPeriodEnd: true }));
    await expect(
      service.change({ serviceId: 'svc-1' }, { subscriptionId: 'sub-1', priceCode: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('calls off a scheduled change when asked for the current plan', async () => {
    prisma.subscription.findUnique.mockResolvedValue(sub({ pendingPriceId: 'basic' }));
    prisma.price.findUnique.mockResolvedValue(price('starter', 15));
    const result = await service.change(
      { serviceId: 'svc-1' },
      { subscriptionId: 'sub-1', priceCode: 'starter-code' },
    );
    expect(result).toEqual({ status: 'unchanged', subscriptionId: 'sub-1' });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { pendingPriceId: null },
    });
    expect(outbox.emit).toHaveBeenCalledWith(
      'billing.subscription.plan_change_cancelled',
      expect.anything(),
      { serviceId: 'svc-1' },
    );
  });
});
