import { randomUUID } from 'node:crypto';
import { AdminOrdersService } from '../src/admin/services/admin-orders.service';
import { CheckoutService } from '../src/checkout/checkout.service';
import { SubscriptionRenewalsService } from '../src/subscription-lifecycle/renewals.service';
import { WalletMerchantsService } from '../src/wallet/wallet-merchants.service';
import { ProviderStatusScheduler } from '../src/workers/provider-status.scheduler';
import { billingDb, cleanBilling, makeIntent, makeOrder, makePlan } from './helpers/billing-db';

/** Which attempt paid, which may still pay, and what two requests do at once. */
describe('the attempt that paid', () => {
  const t = billingDb();
  const { prisma, orchestrator, run, user } = t;
  afterAll(() => cleanBilling(prisma, run, user));

  const order = (o: any) => prisma.order.findUnique({ where: { id: o.id } });
  const one = async (over: any = {}) =>
    makeOrder(prisma, await makePlan(prisma, run), user, { mode: 'PAYMENT', ...over });
  async function renewalOrder(rail = 'HODLE', subOver: any = {}) {
    const price = await makePlan(prisma, run);
    const sub = await prisma.subscription.create({
      data: {
        userId: user,
        priceId: price.id,
        status: 'active',
        rail,
        currentPeriodStart: new Date(Date.now() - 20 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        ...subOver,
      },
    });
    const o = await makeOrder(prisma, price, user, {
      mode: 'PAYMENT',
      metadata: {
        subscriptionRenewal: {
          subscriptionId: sub.id,
          periodEnd: sub.currentPeriodEnd.toISOString(),
        },
      },
    });
    return { sub, o, price };
  }

  it('gives the subscription its rail and link, not one that did not pay', async () => {
    const price = await makePlan(prisma, run);
    const o = await makeOrder(prisma, price, user);
    const a = await makeIntent(prisma, o, { rail: 'CRYPTO', supersededAt: new Date() });
    await makeIntent(prisma, o, { rail: 'LAVA', snapshot: { periodicity: 'MONTHLY' } });
    await orchestrator.applyStateTransition(a.id, 'paid');
    const s = await prisma.subscription.findFirst({ where: { priceId: price.id } });
    expect([s.rail, s.providerSubscriptionId]).toEqual(['CRYPTO', null]);
  });

  it('gives a renewed subscription its rail', async () => {
    const { o, sub } = await renewalOrder();
    const a = await makeIntent(prisma, o, { rail: 'CRYPTO', supersededAt: new Date() });
    await makeIntent(prisma, o, { rail: 'LAVA' });
    await orchestrator.applyStateTransition(a.id, 'paid');
    expect((await prisma.subscription.findUnique({ where: { id: sub.id } })).rail).toBe('CRYPTO');
  });

  it('is taken while a method set aside is still open, though the chosen one ended', async () => {
    const o = await one();
    const a = await makeIntent(prisma, o, { rail: 'HODLE', supersededAt: new Date() });
    const b = await makeIntent(prisma, o, { rail: 'CRYPTO' });
    await orchestrator.applyStateTransition(b.id, 'opened');
    await orchestrator.applyStateTransition(b.id, 'expired');
    expect((await order(o)).status).toBe('created');
    await orchestrator.applyStateTransition(a.id, 'paid');
    expect((await order(o)).status).toBe('paid');
    expect(await prisma.unappliedPayment.count({ where: { orderId: o.id } })).toBe(0);
  });

  it('the order ends when the last open one does, whichever it is', async () => {
    const o = await one();
    const a = await makeIntent(prisma, o, { rail: 'HODLE', supersededAt: new Date() });
    const b = await makeIntent(prisma, o, { rail: 'CRYPTO' });
    await orchestrator.applyStateTransition(b.id, 'expired');
    await orchestrator.applyStateTransition(a.id, 'failed');
    expect((await order(o)).status).toBe('failed');
  });

  it('one set aside that ends does not free an order whose chosen one is under way', async () => {
    const o = await one();
    const a = await makeIntent(prisma, o, { rail: 'HODLE', supersededAt: new Date() });
    const b = await makeIntent(prisma, o, { rail: 'CRYPTO' });
    await orchestrator.applyStateTransition(b.id, 'opened');
    await orchestrator.applyStateTransition(a.id, 'expired');
    expect((await order(o)).status).toBe('open');
  });

  it('is the one an admin refund returns, not money that was kept aside', async () => {
    const o = await one();
    const kept = await makeIntent(prisma, o, { rail: 'CRYPTO', supersededAt: new Date() });
    const main = await makeIntent(prisma, o, { rail: 'HODLE' });
    await orchestrator.applyStateTransition(main.id, 'paid');
    await orchestrator.applyStateTransition(kept.id, 'paid');
    const refunds: string[] = [];
    const admin: any = Object.create(AdminOrdersService.prototype);
    Object.assign(admin, {
      prisma,
      paymentOrchestrator: orchestrator,
      logger: { warn() {}, error() {}, log() {} },
      issueProviderRefund: async (i: any) => void refunds.push(i.id),
    });
    await admin.refundOrder(o.id);
    expect(refunds).toEqual([main.id]);
    expect((await order(o)).status).toBe('refunded');
    expect(await prisma.unappliedPayment.findFirst({ where: { orderId: o.id } })).toMatchObject({
      paymentIntentId: kept.id,
      status: 'open',
    });
  });

  describe('two methods chosen at once', () => {
    /** Both requests are past every earlier check when either opens its payment. */
    function rails(whileBothOpen: () => Promise<unknown> = async () => undefined) {
      let waiting = 0;
      let open: () => void;
      const both = new Promise<void>((resolve) => (open = resolve));
      const released: string[] = [];
      const rail = (code: string, snapshot: any) => ({
        rail: () => code,
        capabilities: () => ({ supportedModes: ['PAYMENT'] }),
        createPaymentIntent: async () => {
          if (++waiting === 2) {
            await whileBothOpen();
            open();
          }
          await both;
          return { providerIntentId: `${code}-${randomUUID()}`, metadata: snapshot };
        },
        getIntentStatus: async () => ({ status: 'created' }),
        releaseIntent: async () => void released.push(code),
      });
      const adapters: any = {
        LAVA: rail('LAVA', { periodicity: 'MONTHLY' }),
        HODLE: rail('HODLE', {}),
      };
      const checkout = new CheckoutService(
        prisma,
        {} as any,
        {
          getAdapter: (c: string) => adapters[c],
          syncIntentWithProvider: async () => ({ status: 'created' }),
        } as any,
        {} as any,
        {} as any,
        { track: jest.fn() } as any,
        { get: () => undefined } as any,
      );
      return { checkout, released };
    }

    it('never sets aside a payment that would start a provider subscription', async () => {
      for (let i = 0; i < 4; i++) {
        const o = await makeOrder(prisma, await makePlan(prisma, run), user);
        const { checkout } = rails();
        await Promise.allSettled([
          checkout.paySession(o.id, user, { rail: 'LAVA' }),
          checkout.paySession(o.id, user, { rail: 'HODLE' }),
        ]);
        const aside = await prisma.paymentIntent.findFirst({
          where: { orderId: o.id, rail: 'LAVA', supersededAt: { not: null } },
        });
        expect(aside).toBeNull();
        expect(
          await prisma.paymentIntent.count({
            where: { orderId: o.id, status: 'created', supersededAt: null },
          }),
        ).toBe(1);
      }
    });

    it('opens nothing on an order that was paid meanwhile', async () => {
      const o = await one();
      const { checkout, released } = rails(() =>
        prisma.order.update({ where: { id: o.id }, data: { status: 'paid' } }),
      );
      const paying = checkout.paySession(o.id, user, { rail: 'HODLE' });
      const other = checkout.paySession(o.id, user, { rail: 'HODLE' });
      const results = await Promise.allSettled([paying, other]);
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect(released).toEqual(['HODLE', 'HODLE']);
      expect(await prisma.paymentIntent.count({ where: { orderId: o.id } })).toBe(0);
    });
  });

  describe('a wallet charge is given up on only for certain', () => {
    const agents: string[] = [];
    afterAll(async () => {
      await prisma.walletAgentPayment.deleteMany({ where: { agentId: { in: agents } } });
      await prisma.walletAgent.deleteMany({ where: { id: { in: agents } } });
      await prisma.wallet.deleteMany({ where: { ownerDid: { startsWith: `did:race:${run}` } } });
      await prisma.x402Payment.deleteMany({ where: { payer: `0x${run}` } });
    });
    async function state(
      chain: () => Promise<{ used: boolean; now: Date }>,
      claim?: string,
      status = 'failed',
    ) {
      const { o } = await renewalOrder();
      const w = await prisma.wallet.create({
        data: {
          ownerDid: `did:race:${run}:${randomUUID()}`,
          address: `0x${randomUUID().replace(/-/g, '')}00000000`,
          subOrganizationId: randomUUID(),
          turnkeyWalletId: 'w',
          credentialId: randomUUID(),
        },
      });
      const agent = await prisma.walletAgent.create({
        data: {
          walletId: w.id,
          kind: 'checkout',
          agentDid: w.ownerDid,
          clientId: 'c',
          requested: {},
          status: 'active',
        },
      });
      agents.push(agent.id);
      const nonce = `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}`;
      const validBefore = new Date('2026-06-01T12:00:00Z');
      await prisma.walletAgentPayment.create({
        data: {
          agentId: agent.id,
          url: 'x',
          merchant: 'x',
          payTo: '0x0',
          valueRaw: '1',
          nonce,
          orderId: o.id,
          status,
          validBefore,
        },
      });
      if (claim) {
        await prisma.x402Payment.create({
          data: {
            orderId: o.id,
            payer: `0x${run}`,
            nonce,
            valueRaw: '1',
            validBefore,
            status: claim,
          },
        });
      }
      const authorization = jest.fn(chain);
      const service = new WalletMerchantsService(
        prisma,
        {} as any,
        { authorization } as any,
        {} as any,
        {} as any,
      );
      const answer = await service.chargeState(o.id);
      if (authorization.mock.calls.length) {
        expect(authorization.mock.calls[0]).toEqual([w.address, nonce]);
      }
      return answer;
    }
    const before = { used: false, now: new Date('2026-06-01T11:59:00Z') };
    const after = { used: false, now: new Date('2026-06-01T12:05:00Z') };

    it.each([
      ['the chain used it', { used: true, now: after.now }, 'submitted', 'pending'],
      ['the chain has not, and still may', before, 'failed', 'pending'],
      ['reverted, and it may still land', before, 'reverted', 'pending'],
      ['never claimed, and it may still land', before, undefined, 'pending'],
      ['the chain never used it and never will', after, 'failed', 'dead'],
      ['never claimed and run out', after, undefined, 'dead'],
      ['reverted and run out', after, 'reverted', 'dead'],
      ['mined: the watcher settles it', after, 'mined', 'pending'],
    ])('%s', async (_n, chain, claim, expected) => {
      await expect(state(async () => chain as any, claim as any)).resolves.toBe(expected);
    });

    it('the chain cannot be read', async () => {
      await expect(
        state(async () => {
          throw new Error('rpc down');
        }, 'failed'),
      ).resolves.toBe('pending');
    });
  });

  it('a renewal link waits while a wallet charge may still land, allowed or not', async () => {
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true';
    const { sub } = await renewalOrder('CRYPTO', {
      currentPeriodEnd: new Date(Date.now() - 3_600_000),
    });
    const notify = jest.fn();
    let charge = 'pending';
    const db = new Proxy(prisma, {
      get: (target, key) => {
        if (key === 'subscription')
          return {
            findMany: (a: any) =>
              target.subscription.findMany({ ...a, where: { ...a.where, id: sub.id } }),
            update: (a: any) => target.subscription.update(a),
          };
        if (key === 'wallet') return { findUnique: async () => null };
        const value = target[key as string];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const service = new SubscriptionRenewalsService(
      db as any,
      {} as any,
      { notify } as any,
      { getContact: async () => null } as any,
      { chargeState: async () => charge, pay: jest.fn() } as any,
      { addRenewalLink: async (id: string) => ({ checkoutUrl: `https://x/${id}` }) } as any,
      { get: () => 'https://billing.example' } as any,
    );
    await service.runSweep(new Date());
    expect(notify).not.toHaveBeenCalled();
    charge = 'dead';
    await service.runSweep(new Date());
    expect(notify).toHaveBeenCalledTimes(1);
    delete process.env.SUBSCRIPTION_RENEWALS_ENABLED;
  });

  it('late money is found behind any number of closed payments', async () => {
    const price = await makePlan(prisma, run);
    const { o } = await renewalOrder('SLOWRAIL');
    const target = await makeIntent(prisma, o, { rail: 'SLOWRAIL', status: 'expired' });
    for (let i = 0; i < 60; i++) {
      const other = await makeOrder(prisma, price, user, { mode: 'PAYMENT', status: 'expired' });
      await makeIntent(prisma, other, { rail: 'SLOWRAIL', status: 'expired' });
    }
    const asked: string[] = [];
    const rail: any = {
      rail: () => 'SLOWRAIL',
      capabilities: () => ({ statusPolling: true }),
      getIntentStatus: async (id: string) => {
        asked.push(id);
        return { status: 'expired' };
      },
    };
    orchestrator.registerAdapter(rail);
    const rails = new Proxy(prisma, {
      get: (p, key) =>
        key === 'paymentProvider'
          ? { findMany: async () => [{ code: 'SLOWRAIL' }] }
          : p[key as string],
    });
    const scheduler = new ProviderStatusScheduler(rails as any, orchestrator, {} as any);
    for (let i = 0; i < 3; i++) await scheduler.poll(new Date(Date.now() + i * 60_000));
    expect(asked).toContain(target.providerIntentId);
    expect(new Set(asked).size).toBe(asked.length);
  });
});
