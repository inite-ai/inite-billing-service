import { randomUUID } from 'node:crypto';
import { LavaAdapter } from '../src/adapters/lava/lava.adapter';
import { StripeAdapter } from '../src/adapters/stripe/stripe.adapter';
import { GooglePlayAdapter } from '../src/adapters/google-play/google-play.adapter';
import { AppleIAPAdapter } from '../src/adapters/apple-iap/apple-iap.adapter';
import { ProviderStatusScheduler } from '../src/workers/provider-status.scheduler';
import {
  billingDb,
  cleanBilling,
  clockAt,
  makeIntent,
  makeOrder,
  makePlan,
} from './helpers/billing-db';

/**
 * A renewal the provider charged is one charge, however billing heard of it,
 * for the amount and the period the provider says. The real adapters run here
 * on a real database; only the network answers are ours.
 */
describe('a renewal charged by a provider', () => {
  const t = billingDb();
  const { prisma, orchestrator, run, user } = t;
  const realFetch = global.fetch;
  const invoices: Record<string, any> = {};

  const withProvider = (config: any) =>
    new Proxy(prisma, {
      get: (target, key) =>
        key === 'paymentProvider'
          ? {
              findUnique: async () => ({ isActive: true, currencies: [], config }),
              findMany: async () => [{ code: 'LAVA' }],
            }
          : target[key as string],
    }) as any;

  const lava = new LavaAdapter(withProvider({ apiKey: 'placeholder-placeholder' }));
  const stripe = new StripeAdapter(withProvider({ secretKey: 'placeholder-placeholder' }));
  orchestrator.registerAdapter(lava as any);
  orchestrator.registerAdapter(stripe as any);

  const scheduler = () =>
    new ProviderStatusScheduler(withProvider({}), orchestrator, {
      runWithLock: (_k: string, _t: number, fn: any) => fn(),
    } as any);

  beforeEach(() => {
    clockAt('2026-01-15T12:00:00Z');
    for (const k of Object.keys(invoices)) delete invoices[k];
    global.fetch = jest.fn(async (url: any) => {
      const id = decodeURIComponent(String(url).split('/').pop()!.split('?')[0]);
      const body = invoices[id];
      return {
        ok: !!body,
        status: body ? 200 : 404,
        json: async () => body,
        text: async () => 'not found',
      } as any;
    }) as any;
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });
  afterAll(() => cleanBilling(prisma, run, user));

  /** A lava.top subscription bought at `at`. */
  async function bought(at: string, over: any = {}) {
    clockAt(at);
    const price = await makePlan(prisma, run, over);
    const order = await makeOrder(prisma, price, user);
    const parent = `first-${randomUUID()}`;
    const intent = await makeIntent(prisma, order, {
      providerIntentId: parent,
      snapshot: { periodicity: 'MONTHLY', buyerEmail: 'buyer@example.com' },
    });
    await orchestrator.applyStateTransition(intent.id, 'paid');
    const sub = await prisma.subscription.findFirst({
      where: { userId: user, priceId: price.id },
    });
    return { price, order, parent, sub };
  }
  const parentInvoice = (parent: string, expiredAt: string, over: any = {}) => {
    invoices[parent] = {
      id: parent,
      status: 'COMPLETED',
      subscriptionStatus: 'ACTIVE',
      subscriptionDetails: { expiredAt },
      receipt: { amount: 29, currency: 'USD' },
      ...over,
    };
  };
  const contract = (id: string, parent: string, amount = 29, currency = 'USD') => {
    invoices[id] = {
      id,
      status: 'COMPLETED',
      parentInvoice: { id: parent },
      receipt: { amount, currency },
    };
  };
  const webhook = async (parent: string, contractId: string) => {
    const parsed = await lava.handleWebhook({
      eventType: 'subscription.recurring.payment.success',
      contractId,
      parentContractId: parent,
    });
    await orchestrator.handleSubscriptionEvent(
      'LAVA',
      parsed.eventType as any,
      parsed.entityId,
      parsed.payload,
    );
  };
  const renewals = (price: any) =>
    prisma.order.findMany({
      where: { priceId: price.id, externalId: { startsWith: 'renewal_' } },
      orderBy: { createdAt: 'asc' },
    });
  const current = (sub: any) => prisma.subscription.findUnique({ where: { id: sub.id } });

  it('is booked once when the poll hears of it first and the webhook comes later', async () => {
    const { price, parent, sub } = await bought('2026-01-15T12:00:00Z');
    parentInvoice(parent, '2026-03-15T12:00:00Z');
    contract(`c-${parent}`, parent);
    clockAt('2026-02-15T12:10:00Z');
    await scheduler().poll();
    expect(await renewals(price)).toHaveLength(1);
    clockAt('2026-02-16T09:00:00Z');
    await webhook(parent, `c-${parent}`);
    expect(await renewals(price)).toHaveLength(1);
    expect((await current(sub)).currentPeriodEnd.toISOString()).toBe('2026-03-15T12:00:00.000Z');
  });

  it('is booked once when the webhook comes first, twice over, and the poll follows', async () => {
    const { price, parent } = await bought('2026-01-15T12:00:00Z');
    parentInvoice(parent, '2026-03-15T12:00:00Z');
    contract(`c-${parent}`, parent);
    clockAt('2026-02-15T12:10:00Z');
    await webhook(parent, `c-${parent}`);
    await webhook(parent, `c-${parent}`);
    await scheduler().poll();
    expect(await renewals(price)).toHaveLength(1);
  });

  it('is booked once when two workers take the two deliveries together', async () => {
    const { price, parent } = await bought('2026-01-15T12:00:00Z');
    parentInvoice(parent, '2026-03-15T12:00:00Z');
    contract(`c-${parent}`, parent);
    clockAt('2026-02-15T12:10:00Z');
    await Promise.allSettled([webhook(parent, `c-${parent}`), scheduler().poll()]);
    expect(await renewals(price)).toHaveLength(1);
  });

  it('does not book again what the old code booked under its period key', async () => {
    const { price, parent, sub } = await bought('2026-01-15T12:00:00Z');
    const old = await makeOrder(prisma, price, user, {
      status: 'paid',
      externalId: `renewal_renewal_${sub.id}_2026-02-15T12:00:00.000Z`,
      metadata: { renewal: true, subscription_id: sub.id },
    });
    await makeIntent(prisma, old, {
      status: 'paid',
      providerIntentId: `renewal_${sub.id}_2026-02-15T12:00:00.000Z`,
    });
    // The old code started the period at the moment it heard.
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        currentPeriodStart: new Date('2026-02-15T12:40:00Z'),
        currentPeriodEnd: new Date('2026-03-15T12:40:00Z'),
      },
    });
    parentInvoice(parent, '2026-03-15T12:00:00Z');
    contract(`c-${parent}`, parent);
    clockAt('2026-02-16T09:00:00Z');
    await webhook(parent, `c-${parent}`);
    expect(await renewals(price)).toHaveLength(1);
  });

  it('records what was charged, not what the catalogue says now', async () => {
    const { price, parent } = await bought('2026-01-15T12:00:00Z');
    await prisma.price.update({ where: { id: price.id }, data: { amount: '99' } });
    parentInvoice(parent, '2026-03-15T12:00:00Z');
    contract(`c-${parent}`, parent, 29, 'USD');
    clockAt('2026-02-15T12:10:00Z');
    await webhook(parent, `c-${parent}`);
    const [order] = await renewals(price);
    expect(order.amount.toString()).toBe('29');
    const invoice = await prisma.invoice.findUnique({ where: { orderId: order.id } });
    expect(invoice.amount.toString()).toBe('29');
  });

  it('takes the provider’s period, so a late word costs no days and drifts nothing', async () => {
    const { price, parent, sub } = await bought('2026-01-15T12:00:00Z');
    parentInvoice(parent, '2026-03-15T12:00:00Z');
    contract(`c-${parent}`, parent);
    clockAt('2026-02-17T20:00:00Z');
    await webhook(parent, `c-${parent}`);
    const after = await current(sub);
    expect(after.currentPeriodStart.toISOString()).toBe('2026-02-15T12:00:00.000Z');
    expect(after.currentPeriodEnd.toISOString()).toBe('2026-03-15T12:00:00.000Z');
    await scheduler().poll();
    expect(await renewals(price)).toHaveLength(1);
  });

  it('follows a small correction of the provider’s date without booking a payment', async () => {
    const { price, parent, sub } = await bought('2026-01-15T12:00:00Z');
    parentInvoice(parent, '2026-02-16T18:00:00Z');
    clockAt('2026-02-15T12:10:00Z');
    await scheduler().poll();
    expect(await renewals(price)).toHaveLength(0);
    expect((await current(sub)).currentPeriodEnd.toISOString()).toBe('2026-02-16T18:00:00.000Z');
  });

  it('does not book a contract lava.top has not completed, or one of another subscription', async () => {
    const { price, parent } = await bought('2026-01-15T12:00:00Z');
    parentInvoice(parent, '2026-03-15T12:00:00Z');
    invoices[`c-${parent}`] = {
      id: `c-${parent}`,
      status: 'FAILED',
      parentInvoice: { id: parent },
    };
    clockAt('2026-02-15T12:10:00Z');
    await expect(webhook(parent, `c-${parent}`)).rejects.toThrow();
    contract(`d-${parent}`, 'someone-else');
    await expect(webhook(parent, `d-${parent}`)).rejects.toThrow();
    expect(await renewals(price)).toHaveLength(0);
  });

  it('puts a past-due subscription back when the provider’s period is the one already held', async () => {
    const { parent, sub } = await bought('2026-01-15T12:00:00Z');
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'past_due' } });
    parentInvoice(parent, '2026-02-15T12:00:00Z');
    contract(`c-${parent}`, parent);
    clockAt('2026-02-10T12:00:00Z');
    await webhook(parent, `c-${parent}`);
    expect((await current(sub)).status).toBe('active');
  });

  describe('Stripe', () => {
    async function stripeSub() {
      const price = await makePlan(prisma, run);
      const id = `sub_${randomUUID()}`;
      const sub = await prisma.subscription.create({
        data: {
          userId: user,
          priceId: price.id,
          status: 'active',
          rail: 'STRIPE',
          providerSubscriptionId: id,
          currentPeriodStart: new Date('2026-01-15T12:00:00Z'),
          currentPeriodEnd: new Date('2026-02-15T12:00:00Z'),
        },
      });
      return { price, id, sub };
    }
    const event = (sub: string, over: any = {}, evt = `evt_${randomUUID()}`) => ({
      id: evt,
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: `in_${sub}`,
          subscription: sub,
          billing_reason: 'subscription_cycle',
          amount_paid: 2900,
          currency: 'usd',
          lines: {
            data: [
              {
                period: {
                  start: Date.parse('2026-02-15T12:00:00Z') / 1000,
                  end: Date.parse('2026-03-15T12:00:00Z') / 1000,
                },
              },
            ],
          },
          ...over,
        },
      },
    });
    const deliver = async (payload: any) => {
      const p = await stripe.handleWebhook(payload);
      await orchestrator.handleSubscriptionEvent(
        'STRIPE',
        p.eventType as any,
        p.entityId,
        p.payload,
      );
    };

    it('keys on the invoice, so the same charge in two events is one renewal', async () => {
      const { price, id } = await stripeSub();
      clockAt('2026-02-15T13:00:00Z');
      await deliver(event(id));
      await deliver(event(id));
      expect(await renewals(price)).toHaveLength(1);
    });

    it('does not renew on the first invoice of the subscription', async () => {
      const { price, id, sub } = await stripeSub();
      await deliver(event(id, { billing_reason: 'subscription_create' }));
      expect(await renewals(price)).toHaveLength(0);
      expect((await current(sub)).currentPeriodEnd.toISOString()).toBe('2026-02-15T12:00:00.000Z');
    });

    it('reads a currency without cents as it is', async () => {
      const { price, id } = await stripeSub();
      clockAt('2026-02-15T13:00:00Z');
      await deliver(event(id, { amount_paid: 10990, currency: 'clp' }));
      const [order] = await renewals(price);
      expect([order.amount.toString(), order.currency]).toEqual(['10990', 'CLP']);
    });
  });

  describe('the app stores name the charge and its period', () => {
    const jws = (o: any) => `x.${Buffer.from(JSON.stringify(o)).toString('base64url')}.y`;

    it('Apple: the transaction, from the signed payload as it is stored', async () => {
      const apple = new AppleIAPAdapter(withProvider({})) as any;
      const payload = {
        signedPayload: jws({
          notificationType: 'DID_RENEW',
          data: {
            signedTransactionInfo: jws({
              transactionId: 'tx-2',
              originalTransactionId: 'tx-1',
              purchaseDate: Date.parse('2026-02-15T12:00:00Z'),
              expiresDate: Date.parse('2026-03-15T12:00:00Z'),
              price: 29990,
              currency: 'USD',
            }),
          },
        }),
      };
      await expect(
        apple.readRenewal({
          providerSubscriptionId: 'tx-1',
          currentPeriodEnd: new Date(),
          payload,
        }),
      ).resolves.toMatchObject({
        chargeId: 'tx-2',
        amount: '29.99',
        currency: 'USD',
        periodEnd: new Date('2026-03-15T12:00:00Z'),
      });
    });

    it('Google: the latest order of the purchase token', async () => {
      const google = new GooglePlayAdapter(withProvider({ packageName: 'app' })) as any;
      google.getAccessToken = async () => 'placeholder';
      invoices['tok'] = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        latestOrderId: 'GPA.1..0',
        lineItems: [
          {
            expiryTime: '2026-03-15T12:00:00Z',
            autoRenewingPlan: {
              recurringPrice: { currencyCode: 'BRL', units: '145', nanos: 500000000 },
            },
          },
        ],
      };
      await expect(
        google.readRenewal({
          providerSubscriptionId: 'tok',
          currentPeriodEnd: new Date(),
          payload: { purchaseToken: 'tok' },
        }),
      ).resolves.toMatchObject({
        chargeId: 'GPA.1..0',
        amount: '145.5',
        currency: 'BRL',
        periodEnd: new Date('2026-03-15T12:00:00Z'),
      });
    });
  });

  describe('a refund', () => {
    async function twoMonths() {
      const b = await bought('2026-01-15T12:00:00Z');
      parentInvoice(b.parent, '2026-03-15T12:00:00Z');
      contract(`c-${b.parent}`, b.parent);
      clockAt('2026-02-15T12:10:00Z');
      await webhook(b.parent, `c-${b.parent}`);
      clockAt('2026-02-20T12:00:00Z');
      const [second] = await renewals(b.price);
      return { ...b, second };
    }
    const refund = async (order: any) => {
      const intent = await prisma.paymentIntent.findFirst({ where: { orderId: order.id } });
      await orchestrator.applyStateTransition(intent.id, 'refunded');
    };

    it('of an earlier month changes no access', async () => {
      const { order, sub } = await twoMonths();
      await refund(order);
      expect((await current(sub)).status).toBe('active');
      expect(
        await prisma.entitlement.count({
          where: {
            userId: user,
            status: 'active',
            value: { path: ['subscription_id'], equals: sub.id },
          },
        }),
      ).toBe(1);
    });

    it('of the running month ends it', async () => {
      const { second, sub } = await twoMonths();
      await refund(second);
      expect((await current(sub)).status).toBe('ended');
    });

    it('still finds the subscription after it moved to another plan', async () => {
      const { second, sub } = await twoMonths();
      const other = await makePlan(prisma, run);
      await prisma.subscription.update({ where: { id: sub.id }, data: { priceId: other.id } });
      await refund(second);
      expect((await current(sub)).status).toBe('ended');
    });

    it('of a month paid ahead takes back only that month', async () => {
      const { price, sub, second } = await twoMonths();
      const ahead = await makeOrder(prisma, price, user, {
        mode: 'PAYMENT',
        metadata: {
          subscriptionRenewal: { subscriptionId: sub.id, periodEnd: '2026-03-15T12:00:00.000Z' },
        },
      });
      const intent = await makeIntent(prisma, ahead, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(intent.id, 'paid');
      expect((await current(sub)).currentPeriodEnd.toISOString()).toBe('2026-04-15T12:00:00.000Z');
      await refund(ahead);
      const after = await current(sub);
      expect(after.status).toBe('active');
      expect(after.currentPeriodEnd.toISOString()).toBe('2026-03-15T12:00:00.000Z');
      expect(after.cancelAtPeriodEnd).toBe(true);
      expect(second.id).toBeTruthy();
    });

    it('of an order written before orders named their subscription: only the newest ends it', async () => {
      const { order, second, sub, price } = await twoMonths();
      await prisma.order.updateMany({
        where: { priceId: price.id },
        data: { subscriptionId: null, periodStart: null, periodEnd: null, metadata: {} },
      });
      await refund(order);
      expect((await current(sub)).status).toBe('active');
      await refund(second);
      expect((await current(sub)).status).toBe('ended');
    });
  });

  it('keeps the 31st through February', async () => {
    const { price, sub } = await bought('2026-01-31T10:00:00Z');
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { rail: 'HODLE', providerSubscriptionId: null },
    });
    const ends = [(await current(sub)).currentPeriodEnd.toISOString()];
    for (let i = 0; i < 2; i++) {
      const now = await current(sub);
      clockAt(new Date(now.currentPeriodEnd.getTime() - 86_400_000).toISOString());
      const order = await makeOrder(prisma, price, user, {
        mode: 'PAYMENT',
        metadata: {
          subscriptionRenewal: {
            subscriptionId: sub.id,
            periodEnd: now.currentPeriodEnd.toISOString(),
          },
        },
      });
      const intent = await makeIntent(prisma, order, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(intent.id, 'paid');
      ends.push((await current(sub)).currentPeriodEnd.toISOString());
    }
    expect(ends).toEqual([
      '2026-02-28T10:00:00.000Z',
      '2026-03-31T10:00:00.000Z',
      '2026-04-30T10:00:00.000Z',
    ]);
  });
});
