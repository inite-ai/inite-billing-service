import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { CreditsService } from '../src/credits/credits.service';
import { definedCredits, orderCompanyId } from '../src/credits/credit-company';
import { OutboxService } from '../src/outbox/outbox.service';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';

/** Credits against the real database: buckets, replays, races and their events. */
const URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5433/inite_billing_test?schema=billing';

describe('credit buckets (integration)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const outbox = new OutboxService(prisma as any);
  const credits = new CreditsService(prisma as any, undefined, outbox);
  const quiet: any = new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) });
  const orchestrator: any = Object.create(PaymentOrchestratorService.prototype);
  Object.assign(orchestrator, {
    prisma,
    outboxService: outbox,
    creditsService: credits,
    funnelService: quiet,
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    handleAffiliateCommission: jest.fn(),
  });

  let serviceId: string;
  let userId: string;

  beforeAll(async () => {
    const tag = randomUUID().slice(0, 8);
    const service = await prisma.service.create({
      data: { code: `cb-${tag}`, name: 'Credit buckets', apiKey: `test-${randomUUID()}` },
    });
    serviceId = service.id;
  });
  beforeEach(() => {
    userId = `u-${randomUUID()}`;
  });
  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { serviceId } });
    await prisma.creditBalance.deleteMany({ where: { serviceId } });
    await prisma.subscription.deleteMany({ where: { price: { product: { serviceId } } } });
    await prisma.paymentIntent.deleteMany({
      where: { order: { price: { product: { serviceId } } } },
    });
    await prisma.invoice.deleteMany({ where: { order: { price: { product: { serviceId } } } } });
    await prisma.order.deleteMany({ where: { price: { product: { serviceId } } } });
    await prisma.price.deleteMany({ where: { product: { serviceId } } });
    await prisma.product.deleteMany({ where: { serviceId } });
    await prisma.service.delete({ where: { id: serviceId } });
    await prisma.$disconnect();
  });

  const balance = async () => {
    const b = await prisma.creditBalance.findFirstOrThrow({ where: { userId, serviceId } });
    expect(b.balance).toBe(b.totalGranted - b.totalUsed);
    const sum = await prisma.creditUsage.aggregate({
      where: { creditBalanceId: b.id },
      _sum: { amount: true },
    });
    expect(sum._sum.amount ?? 0).toBe(b.balance);
    return { period: b.periodBalance, purchased: b.balance - b.periodBalance, total: b.balance };
  };
  const events = async (type: string) =>
    (await prisma.outboxEvent.findMany({ where: { eventType: type, serviceId } }))
      .map((e) => e.payload as any)
      .filter((p) => p.user_id === userId);
  const period = (n: number, orderId?: string) =>
    credits.resetForPeriod({
      userId,
      serviceId,
      newBalance: n,
      resetsAt: new Date(Date.now() + 1e9),
      orderId,
      source: { source: 'subscription', periodEnd: new Date(Date.now() + 1e9) },
    });
  const pack = (n: number, orderId?: string) =>
    credits.grant({ userId, serviceId, amount: n, orderId, source: { source: 'pack' } });
  const spend = (n: number) => credits.consume({ userId, serviceId, amount: n });

  const product = async (
    metadata: any,
    priceMetadata: any = {},
    type = 'subscription',
  ): Promise<any> => {
    const code = `p-${randomUUID()}`;
    const p = await prisma.product.create({
      data: { code, name: code, moduleScope: 'x', type: type as any, serviceId, metadata },
    });
    return prisma.price.create({
      data: {
        productId: p.id,
        code,
        currency: 'USD',
        amount: 10,
        interval: type === 'subscription' ? 'month' : null,
        metadata: priceMetadata,
      },
    });
  };
  const openOrder = async (price: any, mode: string, metadata: any = {}) => {
    const order = await prisma.order.create({
      data: {
        userId,
        priceId: price.id,
        mode: mode as any,
        status: 'open',
        amount: 10,
        currency: 'USD',
        metadata,
        externalId: `o-${randomUUID()}`,
      },
    });
    const intent = await prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        rail: 'STRIPE',
        status: 'opened',
        providerIntentId: `i-${randomUUID()}`,
        amount: 10,
        currency: 'USD',
        snapshot: { subscription: `sub_${randomUUID()}` },
      },
    });
    return { order, intent };
  };

  it('spends period credits first, and a renewal expires only them', async () => {
    await pack(100);
    await period(50);
    await spend(30);
    expect(await balance()).toEqual({ period: 20, purchased: 100, total: 120 });
    await spend(40);
    expect(await balance()).toEqual({ period: 0, purchased: 80, total: 80 });
    await period(50);
    await spend(10);
    await period(60);
    expect(await balance()).toEqual({ period: 60, purchased: 80, total: 140 });
  });

  it('keeps a balance from before the buckets through a renewal', async () => {
    await prisma.creditBalance.create({
      data: { userId, serviceId, balance: 70, totalGranted: 100, totalUsed: 30 },
    });
    const b = await period(50);
    expect([b.balance, b.periodBalance]).toEqual([120, 50]);
  });

  it('grants once per order, however many times the payment is fulfilled at once', async () => {
    const orderId = randomUUID();
    await pack(1);
    await Promise.all(Array.from({ length: 6 }, () => pack(100, orderId)));
    expect((await balance()).total).toBe(101);
    expect((await events('billing.credits.granted')).filter((e) => e.order_id)).toHaveLength(1);
    const renewal = randomUUID();
    await Promise.all(Array.from({ length: 6 }, () => period(50, renewal)));
    await spend(10);
    await period(50, renewal);
    expect((await balance()).period).toBe(40);
  });

  it('revokes a grant once and never takes what already expired', async () => {
    const first = randomUUID();
    await pack(100);
    await period(50, first);
    await spend(20);
    await period(60);
    const grant = await prisma.creditUsage.findFirstOrThrow({
      where: { orderId: first, type: 'grant' },
    });
    const revoke = () =>
      credits.revokeGrant({ userId, serviceId, amount: 50, orderId: first, grant });
    await Promise.all([revoke(), revoke(), revoke()]);
    // 30 of the 50 had expired: the 20 that were spent come back.
    expect(await balance()).toEqual({ period: 40, purchased: 100, total: 140 });
    expect(await events('billing.credits.revoked')).toEqual([
      expect.objectContaining({ grant_id: grant.id, order_id: first, amount: 50 }),
    ]);
  });

  it('leaves a spent refund as a debt that the next period settles', async () => {
    const orderId = randomUUID();
    await period(50, orderId);
    await spend(50);
    const grant = await prisma.creditUsage.findFirstOrThrow({ where: { orderId, type: 'grant' } });
    await credits.revokeGrant({ userId, serviceId, amount: 50, orderId, grant });
    expect((await balance()).total).toBe(-50);
    expect((await spend(1)).success).toBe(false);
    await period(60);
    expect(await balance()).toEqual({ period: 10, purchased: 0, total: 10 });
  });

  it('takes an admin correction from purchased credits before the period', async () => {
    await pack(30);
    await period(50);
    await credits.adminAdjust({ userId, serviceId, amount: -40, description: 'x' });
    expect(await balance()).toEqual({ period: 40, purchased: 0, total: 40 });
    await credits.adminAdjust({ userId, serviceId, amount: 5, description: 'x' });
    expect((await balance()).purchased).toBe(5);
  });

  it('keeps the books when consuming, renewing and buying race', async () => {
    await pack(100);
    await period(100);
    await Promise.all([
      ...Array.from({ length: 15 }, () => spend(10)),
      period(100),
      pack(50),
      credits.adminAdjust({ userId, serviceId, amount: -10, description: 'x' }),
    ]);
    const b = await balance();
    expect(b.period).toBeGreaterThanOrEqual(0);
    expect(b.purchased).toBeGreaterThanOrEqual(0);
  });

  it('rolls the grant back when its event cannot be written', async () => {
    const failing = new CreditsService(prisma as any, undefined, {
      emit: () => Promise.reject(new Error('outbox')),
    } as any);
    await expect(
      failing.grant({ userId, serviceId, amount: 5, source: { source: 'pack' } }),
    ).rejects.toThrow('outbox');
    expect(await prisma.creditUsage.count({ where: { userId } })).toBe(0);
  });

  it('a pack grants its price once, not its product as well', async () => {
    const price = await product({ credits: 999 }, { credits: 500 }, 'one_time');
    const { order, intent } = await openOrder(price, 'PAYMENT', { company_id: 'co-1' });
    for (let i = 0; i < 2; i++) {
      await orchestrator.applyStateTransition(intent.id, 'paid');
    }
    expect(await balance()).toEqual({ period: 0, purchased: 500, total: 500 });
    const grant = await prisma.creditUsage.findFirstOrThrow({ where: { orderId: order.id } });
    expect(await events('billing.credits.granted')).toEqual([
      {
        grant_id: grant.id,
        order_id: order.id,
        user_id: userId,
        company_id: 'co-1',
        source: 'pack',
        amount: 500,
        period_start: null,
        period_end: null,
      },
    ]);
    for (let i = 0; i < 2; i++) {
      await orchestrator.applyStateTransition(intent.id, 'refunded');
    }
    expect((await balance()).total).toBe(0);
    expect(await events('billing.credits.revoked')).toEqual([
      expect.objectContaining({ grant_id: grant.id, company_id: 'co-1', amount: 500 }),
    ]);
  });

  it('a payment event delivered several times at once grants once', async () => {
    const price = await product({}, { credits: 500 }, 'one_time');
    const { intent } = await openOrder(price, 'PAYMENT');
    await Promise.allSettled(
      Array.from({ length: 5 }, () => orchestrator.applyStateTransition(intent.id, 'paid')),
    );
    expect((await balance()).total).toBe(500);
    await Promise.allSettled(
      Array.from({ length: 5 }, () => orchestrator.applyStateTransition(intent.id, 'refunded')),
    );
    expect((await balance()).total).toBe(0);
    expect(await events('billing.credits.revoked')).toHaveLength(1);
  });

  it('a subscription ignores its price, and a replayed renewal grants nothing', async () => {
    const price = await product({ creditsPerPeriod: 100 }, { credits: 7 });
    const { intent } = await openOrder(price, 'SUBSCRIPTION', { company_id: 'co-2' });
    await orchestrator.applyStateTransition(intent.id, 'paid');
    await pack(40);
    await spend(30);
    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId } });
    const renew = () =>
      orchestrator.handleSubscriptionEvent(
        'STRIPE',
        'subscription.renewed',
        sub.providerSubscriptionId,
        { id: `ch-${userId}` },
      );
    await renew();
    await spend(25);
    await renew();
    await Promise.allSettled([renew(), renew()]);
    expect(await balance()).toEqual({ period: 75, purchased: 40, total: 115 });
    const granted = (await events('billing.credits.granted')).filter(
      (e) => e.source === 'subscription',
    );
    expect(granted.map((e) => [e.amount, e.company_id])).toEqual([
      [100, 'co-2'],
      [100, 'co-2'],
    ]);
    expect(granted.every((e) => e.period_start && e.period_end)).toBe(true);
  });

  it('names no company for a renewal when the subscription was paid for two', async () => {
    const price = await product({ creditsPerPeriod: 10 });
    for (const company_id of ['a', 'b']) {
      const { intent } = await openOrder(price, 'SUBSCRIPTION', { company_id });
      await orchestrator.applyStateTransition(intent.id, 'paid');
    }
    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId } });
    await orchestrator.handleSubscriptionEvent(
      'STRIPE',
      'subscription.renewed',
      sub.providerSubscriptionId,
      { id: `ch-${userId}` },
    );
    const companies = (await events('billing.credits.granted')).map((e) => e.company_id);
    expect(companies.sort()).toEqual(['a', 'b', null].sort());
  });

  it('a paid order whose credits are malformed is not marked paid', async () => {
    const price = await product({}, { credits: 1.5 }, 'one_time');
    const { order, intent } = await openOrder(price, 'PAYMENT');
    await expect(orchestrator.applyStateTransition(intent.id, 'paid')).rejects.toThrow('whole');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('open');
  });
});

describe('order metadata', () => {
  it.each([
    undefined,
    null,
    {},
    { company_id: 5 },
    { company_id: ' ' },
    { company_id: 'x'.repeat(129) },
  ])('names no company for %j', (metadata) => expect(orderCompanyId(metadata)).toBeNull());
  it('carries an opaque id', () => expect(orderCompanyId({ company_id: ' c1 ' })).toBe('c1'));
  it('reads credits', () => {
    expect(definedCredits('500')).toBe(500);
    expect(definedCredits(0)).toBeNull();
    expect(definedCredits(undefined)).toBeNull();
    for (const bad of [-1, 1.5, 'many', {}]) expect(() => definedCredits(bad)).toThrow();
  });
});
