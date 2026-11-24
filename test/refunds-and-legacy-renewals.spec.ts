import { randomUUID } from 'node:crypto';
import { AdminOrdersService } from '../src/admin/services/admin-orders.service';
import { LavaAdapter } from '../src/adapters/lava/lava.adapter';
import { billingDb, cleanBilling, makeIntent, makeOrder, makePlan } from './helpers/billing-db';

/**
 * Orders written before they named their subscription and period, refunds
 * asked by an admin, and subscriptions whose clock runs ahead of the provider's.
 */
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe('refunds and rows from before', () => {
  const t = billingDb();
  const { prisma, orchestrator, run, user } = t;
  const realFetch = global.fetch;
  const invoices: Record<string, any> = {};
  const lava = new LavaAdapter(
    new Proxy(prisma, {
      get: (target, key) =>
        key === 'paymentProvider'
          ? {
              findUnique: async () => ({
                isActive: true,
                currencies: [],
                config: { apiKey: 'placeholder-placeholder' },
              }),
            }
          : target[key as string],
    }) as any,
  );
  orchestrator.registerAdapter(lava as any);
  const admin: any = Object.create(AdminOrdersService.prototype);
  const refunded: string[] = [];
  Object.assign(admin, {
    prisma,
    paymentOrchestrator: orchestrator,
    logger: { warn() {}, error() {}, log() {} },
    issueProviderRefund: async (intent: any) => void refunded.push(intent.id),
  });
  let cancel: jest.SpyInstance;

  beforeEach(() => {
    refunded.length = 0;
    cancel = jest.spyOn(orchestrator, 'cancelProviderSubscription').mockResolvedValue(true);
    global.fetch = jest.fn(async (url: any) => {
      const body = invoices[decodeURIComponent(String(url).split('/').pop()!)];
      return { ok: !!body, status: body ? 200 : 404, json: async () => body, text: async () => '' };
    }) as any;
  });
  afterEach(() => {
    cancel.mockRestore();
    global.fetch = realFetch;
  });
  afterAll(() => cleanBilling(prisma, run, user));

  const status = async (s: any) =>
    (await prisma.subscription.findUnique({ where: { id: s.id } })).status;
  async function subOf(price: any, over: any = {}) {
    return prisma.subscription.create({
      data: {
        userId: user,
        priceId: price.id,
        status: 'active',
        rail: 'LAVA',
        providerSubscriptionId: `c-${randomUUID()}`,
        currentPeriodStart: ago(5),
        currentPeriodEnd: ago(-25),
        ...over,
      },
    });
  }
  async function paid(price: any, createdAt: Date, over: any = {}) {
    const order = await makeOrder(prisma, price, user, { status: 'paid', createdAt, ...over });
    await prisma.invoice.create({
      data: {
        orderId: order.id,
        status: 'paid',
        amount: order.amount,
        currency: order.currency,
        createdAt,
      },
    });
    const intent = await makeIntent(prisma, order, { status: 'paid' });
    return { order, intent };
  }
  const renewalOf = (s: any) => ({ metadata: { renewal: true, subscription_id: s.id } });

  describe('a provider renewal booked before orders carried a period', () => {
    it('refunded for an old month leaves access alone; the newest one ends it', async () => {
      const price = await makePlan(prisma, run);
      const s = await subOf(price);
      const old = await paid(price, ago(65), renewalOf(s));
      const now = await paid(price, ago(5), renewalOf(s));
      await orchestrator.applyStateTransition(old.intent.id, 'refunded');
      expect(await status(s)).toBe('active');
      await orchestrator.applyStateTransition(now.intent.id, 'refunded');
      expect(await status(s)).toBe('ended');
    });

    it('is an old month even when the newer one was paid on another plan', async () => {
      const price = await makePlan(prisma, run);
      const other = await makePlan(prisma, run);
      const s = await subOf(other);
      const old = await paid(price, ago(35), renewalOf(s));
      await paid(other, ago(5), renewalOf(s));
      await orchestrator.applyStateTransition(old.intent.id, 'refunded');
      expect(await status(s)).toBe('active');
    });

    it('an unlinked first order is an old month once a linked renewal followed', async () => {
      const price = await makePlan(prisma, run);
      const first = await paid(price, ago(35));
      const s = await subOf(price, { createdAt: ago(35) });
      await paid(price, ago(5), renewalOf(s));
      await orchestrator.applyStateTransition(first.intent.id, 'refunded');
      expect(await status(s)).toBe('active');
    });

    it('an unlinked first order is found by when it was paid, after a plan change too', async () => {
      const price = await makePlan(prisma, run);
      const other = await makePlan(prisma, run);
      const first = await paid(price, ago(5));
      const s = await subOf(other, { createdAt: ago(5) });
      await orchestrator.applyStateTransition(first.intent.id, 'refunded');
      expect(await status(s)).toBe('ended');
    });

    it('a period bought once, or another subscription, is not a newer month of this one', async () => {
      const price = await makePlan(prisma, run);
      const first = await paid(price, ago(5));
      const s = await subOf(price, { createdAt: ago(5) });
      await paid(price, ago(2), { mode: 'PAYMENT' });
      await orchestrator.applyStateTransition(first.intent.id, 'refunded');
      expect(await status(s)).toBe('ended');
    });

    it('a refund for a subscription that ended leaves the one bought after it', async () => {
      const price = await makePlan(prisma, run);
      const first = await paid(price, ago(90));
      await subOf(price, { createdAt: ago(90), status: 'ended' });
      const s = await subOf(price, { createdAt: ago(5) });
      await orchestrator.applyStateTransition(first.intent.id, 'refunded');
      expect(await status(s)).toBe('active');
    });
  });

  describe('an admin refund', () => {
    it('of an old month does not cancel the provider’s billing', async () => {
      const price = await makePlan(prisma, run);
      const s = await subOf(price);
      const { order } = await paid(price, ago(65), {
        subscriptionId: s.id,
        periodStart: ago(65),
        periodEnd: ago(35),
      });
      await admin.refundOrder(order.id);
      expect(await status(s)).toBe('active');
      expect(cancel).not.toHaveBeenCalled();
    });

    it('of the running month cancels it at once', async () => {
      const price = await makePlan(prisma, run);
      const s = await subOf(price);
      const { order } = await paid(price, ago(5), {
        subscriptionId: s.id,
        periodStart: ago(5),
        periodEnd: ago(-25),
      });
      await admin.refundOrder(order.id);
      expect(await status(s)).toBe('ended');
      expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ id: s.id }), false);
    });

    it('of a month paid ahead stops it at the end of the running one', async () => {
      const price = await makePlan(prisma, run);
      const s = await subOf(price, { currentPeriodStart: ago(-10), currentPeriodEnd: ago(-40) });
      const { order } = await paid(price, ago(1), {
        subscriptionId: s.id,
        periodStart: s.currentPeriodStart,
        periodEnd: s.currentPeriodEnd,
      });
      await admin.refundOrder(order.id);
      expect(await status(s)).toBe('active');
      expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ id: s.id }), true);
    });
  });

  describe('a charge of a subscription whose clock was moved twice', () => {
    async function doubled() {
      const price = await makePlan(prisma, run);
      const parent = `first-${randomUUID()}`;
      // Bought 35 days ago, charged 5 days ago; the old code had already moved
      // the clock past that, with an order for a charge that never happened.
      const s = await subOf(price, {
        providerSubscriptionId: parent,
        createdAt: ago(65),
        currentPeriodStart: ago(5),
        currentPeriodEnd: ago(-25),
      });
      await paid(price, ago(34.9), renewalOf(s));
      await paid(price, ago(34.8), renewalOf(s));
      invoices[parent] = {
        id: parent,
        status: 'COMPLETED',
        subscriptionDetails: { expiredAt: s.currentPeriodEnd.toISOString() },
        receipt: { amount: 29, currency: 'USD' },
      };
      const charge = (id: string, at: Date) => {
        invoices[id] = {
          id,
          status: 'COMPLETED',
          datetime: at.toISOString(),
          parentInvoice: { id: parent },
          receipt: { amount: 29, currency: 'USD' },
        };
        return orchestrator.handleSubscriptionEvent('LAVA', 'subscription.renewed', parent, {
          contractId: id,
        });
      };
      const orders = () =>
        prisma.order.findMany({
          where: { priceId: price.id },
          orderBy: { createdAt: 'asc' },
        });
      return { s, parent, charge, orders };
    }

    it('is recorded, once, and moves nothing', async () => {
      const { s, charge, orders } = await doubled();
      t.credits.resetForPeriod.mockClear();
      const id = `c-${randomUUID()}`;
      await charge(id, ago(5));
      await charge(id, ago(5));
      const rows = await orders();
      expect(rows).toHaveLength(3);
      expect(rows[2]).toMatchObject({ status: 'paid', subscriptionId: s.id });
      expect(rows[2].metadata.recorded_only).toBe(true);
      const after = await prisma.subscription.findUnique({ where: { id: s.id } });
      expect(after.currentPeriodEnd.getTime()).toBe(s.currentPeriodEnd.getTime());
      expect(await prisma.invoice.count({ where: { orderId: rows[2].id } })).toBe(1);
      expect(t.credits.resetForPeriod).not.toHaveBeenCalled();
    });

    it('a late word of a charge already booked takes that order, not a new one', async () => {
      const { charge, orders } = await doubled();
      const id = `c-${randomUUID()}`;
      await charge(id, ago(34.9));
      await charge(id, ago(34.9));
      const rows = await orders();
      expect(rows).toHaveLength(2);
      expect(
        rows.filter((o: any) => o.metadata.provider_charge_aliases?.includes(id)),
      ).toHaveLength(1);
    });

    it('is retried while lava.top has not moved its own date yet', async () => {
      const { parent, charge, orders } = await doubled();
      invoices[parent].subscriptionDetails.expiredAt = ago(5).toISOString();
      await expect(charge(`c-${randomUUID()}`, ago(5))).rejects.toThrow(/not moved/);
      expect(await orders()).toHaveLength(2);
    });
  });
});
