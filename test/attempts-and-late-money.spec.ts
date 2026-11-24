import { randomUUID } from 'node:crypto';
import { CheckoutService } from '../src/checkout/checkout.service';
import { ProviderStatusScheduler } from '../src/workers/provider-status.scheduler';
import { WebhookProcessor } from '../src/workers/webhook.processor';
import { WalletMerchantsService } from '../src/wallet/wallet-merchants.service';
import { SubscriptionRenewalsService } from '../src/subscription-lifecycle/renewals.service';
import { billingDb, cleanBilling, makeIntent, makeOrder, makePlan } from './helpers/billing-db';

/**
 * An attempt is not the thing being paid: it can end, be replaced or succeed
 * late, and the renewal, the money and the grant each keep to their own rule.
 * A real database; the rails are scripted.
 */
describe('attempts, switching and late money', () => {
  const t = billingDb();
  const { prisma, orchestrator, run, user, events } = t;

  class ScriptedRail {
    calls = 0;
    answers: Record<string, any> = {};
    constructor(private readonly code: string) {}
    rail() {
      return this.code;
    }
    capabilities() {
      return { supportedModes: ['PAYMENT'], statusPolling: true } as any;
    }
    async createPaymentIntent() {
      this.calls++;
      return {
        providerIntentId: `${this.code}-${randomUUID()}`,
        checkoutUrl: `https://${this.code}.example`,
      };
    }
    async getIntentStatus(id: string) {
      return this.answers[id] ?? { status: 'created' };
    }
  }
  const pix = new ScriptedRail('HODLE');
  const card = new ScriptedRail('LAVA');
  const coin = new ScriptedRail('CRYPTO');
  for (const rail of [pix, card, coin]) orchestrator.registerAdapter(rail as any);

  const checkout = new CheckoutService(
    prisma,
    {} as any,
    orchestrator,
    {} as any,
    {} as any,
    { track: jest.fn() } as any,
    { get: () => undefined } as any,
  );

  afterAll(() => cleanBilling(prisma, run, user));

  async function renewal(price?: any) {
    price ??= await makePlan(prisma, run);
    const sub = await prisma.subscription.create({
      data: {
        userId: user,
        priceId: price.id,
        status: 'active',
        rail: 'HODLE',
        currentPeriodStart: new Date(Date.now() - 29 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });
    const order = await makeOrder(prisma, price, user, {
      mode: 'PAYMENT',
      metadata: {
        subscriptionRenewal: {
          subscriptionId: sub.id,
          periodEnd: sub.currentPeriodEnd.toISOString(),
        },
      },
    });
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { renewalOrderId: order.id },
    });
    return { price, sub, order };
  }
  const one = async () => makeOrder(prisma, await makePlan(prisma, run), user, { mode: 'PAYMENT' });
  const order = (o: any) => prisma.order.findUnique({ where: { id: o.id } });
  const unapplied = (o: any) => prisma.unappliedPayment.findMany({ where: { orderId: o.id } });
  const invoices = (o: any) => prisma.invoice.count({ where: { orderId: o.id } });
  const paidAnswer = (o: any, over: any = {}) => ({
    status: 'paid',
    amount: Number(o.amount),
    currency: o.currency,
    providerData: { late: true },
    ...over,
  });

  describe('a renewal', () => {
    it.each(['expired', 'failed'] as const)('is still payable after an attempt %s', async (end) => {
      const { order: o, sub } = await renewal();
      const a = await makeIntent(prisma, o, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(a.id, 'opened');
      await orchestrator.applyStateTransition(a.id, end);
      expect((await order(o)).status).toBe('created');
      const second = await checkout.paySession(o.id, user, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(second.paymentIntentId!, 'paid');
      expect((await order(o)).status).toBe('paid');
      const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
      expect(after.currentPeriodStart.getTime()).toBe(sub.currentPeriodEnd.getTime());
    });

    it('takes a first attempt’s money that comes after its timer', async () => {
      const { order: o } = await renewal();
      const a = await makeIntent(prisma, o, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(a.id, 'expired');
      await orchestrator.settleLate(a.id, paidAnswer(o) as any);
      expect((await order(o)).status).toBe('paid');
      expect(await invoices(o)).toBe(1);
      expect(await unapplied(o)).toHaveLength(0);
    });

    it('is granted once when both attempts are paid; the second is kept for a person', async () => {
      const { order: o, sub } = await renewal();
      const a = await makeIntent(prisma, o, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(a.id, 'expired');
      const b = await makeIntent(prisma, o, { rail: 'CRYPTO' });
      await Promise.all([
        orchestrator.applyStateTransition(b.id, 'paid'),
        orchestrator.settleLate(a.id, paidAnswer(o) as any),
      ]);
      await orchestrator.settleLate(a.id, paidAnswer(o) as any);
      expect(await invoices(o)).toBe(1);
      expect(await unapplied(o)).toHaveLength(1);
      const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
      expect(after.currentPeriodStart.getTime()).toBe(sub.currentPeriodEnd.getTime());
    });
  });

  describe('a one-time order', () => {
    it('still ends with its only attempt', async () => {
      const o = await one();
      const a = await makeIntent(prisma, o);
      await orchestrator.applyStateTransition(a.id, 'expired');
      expect((await order(o)).status).toBe('expired');
    });

    it('keeps late money for a person instead of dropping it, and grants nothing', async () => {
      const o = await one();
      const a = await makeIntent(prisma, o);
      await orchestrator.applyStateTransition(a.id, 'expired');
      await orchestrator.settleLate(a.id, paidAnswer(o) as any);
      expect((await order(o)).status).toBe('expired');
      expect(await unapplied(o)).toMatchObject([{ reason: 'order_closed', status: 'open' }]);
      expect(await invoices(o)).toBe(0);
      expect(events.some((e) => e.type === 'billing.payment.unapplied')).toBe(true);
    });

    it('does not take a late payment of the wrong amount as paid', async () => {
      const { order: o } = await renewal();
      const a = await makeIntent(prisma, o);
      await orchestrator.applyStateTransition(a.id, 'failed');
      await orchestrator.settleLate(a.id, paidAnswer(o, { amount: 1 }) as any);
      expect((await order(o)).status).toBe('created');
      expect(await unapplied(o)).toMatchObject([{ reason: 'amount_too_low' }]);
    });

    it('stays paid when another attempt ends, and when a refund of kept money arrives', async () => {
      const o = await one();
      const a = await makeIntent(prisma, o, { supersededAt: new Date() });
      const b = await makeIntent(prisma, o, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(b.id, 'paid');
      await orchestrator.applyStateTransition(a.id, 'expired');
      expect((await order(o)).status).toBe('paid');
      await orchestrator.settleLate(a.id, paidAnswer(o) as any);
      expect(await unapplied(o)).toMatchObject([{ reason: 'already_paid' }]);
      await orchestrator.applyStateTransition(a.id, 'refunded');
      expect((await order(o)).status).toBe('paid');
      expect(await unapplied(o)).toMatchObject([{ status: 'refunded' }]);
    });
  });

  describe('switching method', () => {
    it('closes the first attempt and opens the second, with no server error', async () => {
      const o = await one();
      const first = await checkout.paySession(o.id, user, { rail: 'LAVA' });
      const second = await checkout.paySession(o.id, user, { rail: 'HODLE' });
      expect(second.paymentIntentId).not.toBe(first.paymentIntentId);
      const a = await prisma.paymentIntent.findUnique({ where: { id: first.paymentIntentId } });
      expect(a.supersededAt).toBeTruthy();
      await orchestrator.applyStateTransition(first.paymentIntentId!, 'expired');
      expect((await order(o)).status).toBe('created');
      await orchestrator.applyStateTransition(second.paymentIntentId!, 'paid');
      expect((await order(o)).status).toBe('paid');
    });

    it('brings the first attempt back instead of opening a third', async () => {
      const o = await one();
      const first = await checkout.paySession(o.id, user, { rail: 'LAVA' });
      await checkout.paySession(o.id, user, { rail: 'HODLE' });
      const back = await checkout.paySession(o.id, user, { rail: 'LAVA' });
      expect(back.paymentIntentId).toBe(first.paymentIntentId);
    });

    it('the replaced attempt, paid, pays the order; the other one is then kept aside', async () => {
      const o = await one();
      const first = await checkout.paySession(o.id, user, { rail: 'LAVA' });
      const second = await checkout.paySession(o.id, user, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(first.paymentIntentId!, 'paid');
      await orchestrator.applyStateTransition(second.paymentIntentId!, 'paid');
      expect((await order(o)).status).toBe('paid');
      expect(await invoices(o)).toBe(1);
      expect(await unapplied(o)).toMatchObject([{ paymentIntentId: second.paymentIntentId }]);
    });

    it('is refused when the provider says the first is already paid', async () => {
      const o = await one();
      const first = await checkout.paySession(o.id, user, { rail: 'LAVA' });
      const a = await prisma.paymentIntent.findUnique({ where: { id: first.paymentIntentId } });
      card.answers[a.providerIntentId] = paidAnswer(o);
      await expect(checkout.paySession(o.id, user, { rail: 'HODLE' })).rejects.toThrow();
      expect((await order(o)).status).toBe('paid');
    });

    it('is refused, opening nothing, while a provider subscription may still start', async () => {
      const o = await makeOrder(prisma, await makePlan(prisma, run), user);
      await makeIntent(prisma, o, { snapshot: { periodicity: 'MONTHLY' } });
      const before = pix.calls;
      await expect(checkout.paySession(o.id, user, { rail: 'HODLE' })).rejects.toThrow(
        /still open/,
      );
      expect(pix.calls).toBe(before);
    });

    it('two tabs choosing two methods at once leave one open attempt', async () => {
      const o = await one();
      await Promise.allSettled([
        checkout.paySession(o.id, user, { rail: 'LAVA' }),
        checkout.paySession(o.id, user, { rail: 'HODLE' }),
      ]);
      expect(
        await prisma.paymentIntent.count({
          where: { orderId: o.id, status: 'created', supersededAt: null },
        }),
      ).toBe(1);
    });
  });

  describe('how late money is heard of', () => {
    it('by webhook', async () => {
      const { order: o } = await renewal();
      const a = await makeIntent(prisma, o, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(a.id, 'expired');
      pix.answers[a.providerIntentId] = paidAnswer(o);
      const webhookId = `wh-${randomUUID()}`;
      await prisma.webhookEvent.create({
        data: {
          rail: 'HODLE',
          webhookId,
          eventType: 'payment.paid',
          entityId: a.providerIntentId,
          payload: {},
        },
      });
      await new WebhookProcessor(prisma, orchestrator).process({
        data: { rail: 'HODLE', webhookId },
      } as any);
      expect((await order(o)).status).toBe('paid');
      await prisma.webhookEvent.deleteMany({ where: { webhookId } });
    });

    it('by the poll, for a payment given up on in the last three days', async () => {
      const { order: o } = await renewal();
      const a = await makeIntent(prisma, o, { rail: 'HODLE' });
      await orchestrator.applyStateTransition(a.id, 'expired');
      pix.answers[a.providerIntentId] = paidAnswer(o);
      const rails = new Proxy(prisma, {
        get: (target, key) =>
          key === 'paymentProvider'
            ? { findMany: async () => [{ code: 'HODLE' }] }
            : target[key as string],
      });
      await new ProviderStatusScheduler(rails as any, orchestrator, {} as any).poll();
      expect((await order(o)).status).toBe('paid');
    });
  });

  describe('the wallet', () => {
    const wallet = { id: randomUUID(), address: '0x0000000000000000000000000000000000000001' };
    const build = (over: { balance?: bigint; perPayment?: string; spent?: any[] }) => {
      const paySession = jest.fn().mockRejectedValue(new Error('an invoice was opened'));
      const db = new Proxy(prisma, {
        get: (target, key) => {
          if (key === 'wallet') return { findUnique: async () => wallet };
          if (key === 'walletAgent') return { findFirst: async () => ({ id: 'agent' }) };
          if (key === 'walletMerchant')
            return {
              findFirst: async () => ({
                perPayment: over.perPayment ?? '100',
                monthly: '100',
                serviceId: 's',
              }),
            };
          if (key === 'walletAgentPayment') return { findMany: async () => over.spent ?? [] };
          return target[key as string];
        },
      });
      const service = new WalletMerchantsService(
        db as any,
        {} as any,
        { usdcBalance: async () => over.balance ?? 10n ** 12n } as any,
        { paySession } as any,
        { get: () => undefined } as any,
      );
      (service as any).settlements = { relayer: async () => ({}) };
      return { service, paySession };
    };
    it.each([
      ['insufficient_funds', { balance: 1n }],
      ['over_limit', { perPayment: '5' }],
      ['over_limit', { spent: [{ valueRaw: '90000000' }] }],
    ])('says %s before any invoice is opened', async (reason, over) => {
      const { order: o, price } = await renewal();
      const { service, paySession } = build(over as any);
      await expect(
        service.pay({
          ownerDid: user,
          orderId: o.id,
          serviceId: price.product.serviceId,
          serviceCode: 'x',
        }),
      ).resolves.toMatchObject({ status: 'needs_approval', reason });
      expect(paySession).not.toHaveBeenCalled();
    });
  });

  describe('the renewals sweep', () => {
    const env = process.env.SUBSCRIPTION_RENEWALS_ENABLED;
    beforeAll(() => (process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true'));
    afterAll(() => {
      if (env === undefined) delete process.env.SUBSCRIPTION_RENEWALS_ENABLED;
      else process.env.SUBSCRIPTION_RENEWALS_ENABLED = env;
    });
    const build = (merchants: any, allowed = true) => {
      const notify = jest.fn();
      const db = new Proxy(prisma, {
        get: (target, key) => {
          if (key === 'subscription')
            return {
              ...target.subscription,
              findMany: (a: any) =>
                target.subscription.findMany({ ...a, where: { ...a.where, userId: user } }),
              update: (a: any) => target.subscription.update(a),
            };
          if (key === 'wallet') return { findUnique: async () => (allowed ? { id: 'w' } : null) };
          if (key === 'walletMerchant') return { findFirst: async () => ({ id: 'm' }) };
          return target[key as string];
        },
      });
      const service = new SubscriptionRenewalsService(
        db as any,
        {} as any,
        { notify } as any,
        { getContact: async () => null } as any,
        merchants,
        { reopen: async (id: string) => ({ checkoutUrl: `https://x/${id}` }) } as any,
        { get: () => 'https://billing.example' } as any,
      );
      return { service, notify };
    };
    async function due() {
      await prisma.subscription.deleteMany({ where: { userId: user } });
      const price = await makePlan(prisma, run);
      const sub = await prisma.subscription.create({
        data: {
          userId: user,
          priceId: price.id,
          status: 'past_due',
          rail: 'CRYPTO',
          currentPeriodStart: new Date(Date.now() - 31 * 86_400_000),
          currentPeriodEnd: new Date(Date.now() - 3_600_000),
        },
      });
      return { price, sub };
    }

    it('opens a fresh order when the last one was closed by a plan change', async () => {
      const { sub } = await due();
      const { service } = build({ pay: jest.fn(), chargeState: async () => 'none' }, false);
      await service.runSweep(new Date());
      const first = await prisma.subscription.findUnique({ where: { id: sub.id } });
      await prisma.order.update({
        where: { id: first.renewalOrderId },
        data: { status: 'expired' },
      });
      await prisma.subscription.update({ where: { id: sub.id }, data: { renewalOrderId: null } });
      await service.runSweep(new Date());
      const second = await prisma.subscription.findUnique({ where: { id: sub.id } });
      expect(second.renewalOrderId).not.toBe(first.renewalOrderId);
      expect((await order({ id: second.renewalOrderId })).status).toBe('created');
    });

    it('reopens a renewal an expired attempt had ended before this rule', async () => {
      const { sub } = await due();
      const { service } = build({ pay: jest.fn(), chargeState: async () => 'none' }, false);
      await service.runSweep(new Date());
      const row = await prisma.subscription.findUnique({ where: { id: sub.id } });
      await prisma.order.update({ where: { id: row.renewalOrderId }, data: { status: 'expired' } });
      await service.runSweep(new Date());
      expect((await order({ id: row.renewalOrderId })).status).toBe('created');
    });
  });
});
