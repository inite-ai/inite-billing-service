import { randomUUID } from 'node:crypto';
import { CheckoutService } from '../src/checkout/checkout.service';
import { SessionLinksService } from '../src/service-api/session-links';
import { SubscriptionRenewalsService } from '../src/subscription-lifecycle/renewals.service';
import { reminderStep } from '../src/subscription-lifecycle/renewal-reminders';
import {
  renewalAmount,
  renewalCopy,
  renewalLocale,
} from '../src/subscription-lifecycle/renewal-copy';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { billingDb, cleanBilling, clockAt, makeIntent, makePlan } from './helpers/billing-db';

/** A renewal is paid on one page for as long as it is unpaid, and asked for politely. */
describe('the renewal pay page and its letters', () => {
  const t = billingDb();
  const { prisma, orchestrator, run, user } = t;
  const env = process.env.SUBSCRIPTION_RENEWALS_ENABLED;
  const notify = jest.fn();
  let locale = 'en';

  const config = { get: () => undefined } as any;
  const links = new SessionLinksService(prisma, config, { available: async () => false } as any);
  const checkout = new CheckoutService(
    prisma,
    {} as any,
    orchestrator,
    {} as any,
    {} as any,
    {} as any,
    config,
  );
  const db = new Proxy(prisma, {
    get: (target, key) =>
      key === 'subscription'
        ? {
            findMany: (a: any) =>
              target.subscription.findMany({ ...a, where: { ...a.where, userId: user } }),
            update: (a: any) => target.subscription.update(a),
          }
        : typeof target[key as string] === 'function'
          ? target[key as string].bind(target)
          : target[key as string],
  }) as any;
  const sweeps = () =>
    new SubscriptionRenewalsService(
      db,
      {} as any,
      { notify } as any,
      { getContact: async () => ({ locale }) } as any,
      {} as any,
      links,
      config,
    );

  beforeEach(async () => {
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true';
    notify.mockReset();
    locale = 'en';
    await prisma.subscription.deleteMany({ where: { userId: user } });
  });
  afterEach(() => jest.useRealTimers());
  afterAll(async () => {
    if (env === undefined) delete process.env.SUBSCRIPTION_RENEWALS_ENABLED;
    else process.env.SUBSCRIPTION_RENEWALS_ENABLED = env;
    await cleanBilling(prisma, run, user);
  });

  async function plan(over: any = {}) {
    const price = await makePlan(prisma, run, { graceDays: 7, ...over });
    return prisma.subscription.create({
      data: {
        userId: user,
        priceId: price.id,
        status: 'active',
        rail: 'HODLE',
        currentPeriodStart: new Date('2026-03-10T00:00:00Z'),
        currentPeriodEnd: new Date('2026-04-10T00:00:00Z'),
      },
    });
  }
  const at = async (iso: string) => {
    clockAt(iso);
    await sweeps().runSweep(new Date(iso));
  };
  const steps = () => notify.mock.calls.map((c) => c[0].metadata.step);

  it('sends four letters over a grace of seven days, each once, hour after hour', async () => {
    await plan();
    for (const iso of [
      '2026-04-07T12:00:00Z',
      '2026-04-07T13:00:00Z',
      '2026-04-10T01:00:00Z',
      '2026-04-10T02:00:00Z',
      '2026-04-13T13:00:00Z',
      '2026-04-14T13:00:00Z',
      '2026-04-16T01:00:00Z',
      '2026-04-16T12:00:00Z',
      '2026-04-17T01:00:00Z',
    ]) {
      await at(iso);
    }
    expect(steps()).toEqual(['lead', 'due', 'mid', 'last']);
  });

  it('two sweeps at once send one letter', async () => {
    await plan();
    const now = new Date('2026-04-07T12:00:00Z');
    await Promise.all([sweeps().runSweep(now), sweeps().runSweep(now)]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a letter that could not be sent is sent by the next sweep', async () => {
    await plan();
    notify.mockRejectedValueOnce(new Error('queue down'));
    await at('2026-04-07T12:00:00Z');
    await at('2026-04-07T13:00:00Z');
    expect(steps()).toEqual(['lead', 'lead']);
  });

  it('every letter’s link opens the same page until the renewal is paid', async () => {
    await plan();
    await at('2026-04-07T12:00:00Z');
    await at('2026-04-10T01:00:00Z');
    const urls = notify.mock.calls.map((c) => new URL(c[0].metadata.ctaUrl));
    expect(urls[0].pathname).toBe(urls[1].pathname);
    for (const url of urls) {
      const id = url.pathname.split('/').pop()!;
      const token = url.hash.slice('#t='.length);
      await expect(checkout.getSession(id, undefined, undefined, token)).resolves.toMatchObject({
        sessionId: id,
        status: 'created',
      });
    }
    const id = urls[0].pathname.split('/').pop()!;
    await expect(checkout.getSession(id, undefined, undefined, 'not-a-token')).rejects.toThrow();
  });

  it('stops when it is paid, and when an expired attempt is still payable it does not', async () => {
    const sub = await plan();
    await at('2026-04-07T12:00:00Z');
    const { renewalOrderId } = await prisma.subscription.findUnique({ where: { id: sub.id } });
    const order = await prisma.order.findUnique({ where: { id: renewalOrderId } });
    const first = await makeIntent(prisma, order, { rail: 'HODLE' });
    await orchestrator.applyStateTransition(first.id, 'expired');
    await at('2026-04-10T01:00:00Z');
    const second = await makeIntent(prisma, order, { rail: 'HODLE' });
    await orchestrator.applyStateTransition(second.id, 'paid');
    await at('2026-04-13T13:00:00Z');
    expect(steps()).toEqual(['lead', 'due']);
    const paid = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(paid.currentPeriodEnd.toISOString()).toBe('2026-05-10T00:00:00.000Z');
  });

  it.each([
    ['pt-BR', 'pt', 'Renove sua assinatura'],
    ['es', 'es', 'Renueva tu suscripción'],
    ['ru', 'ru', 'Продлите подписку'],
    ['de', 'en', 'Renew your'],
  ])('is written in the reader’s language: %s', async (asked, used, start) => {
    locale = asked;
    await plan();
    await at('2026-04-07T12:00:00Z');
    expect(notify.mock.calls[0][0].title.startsWith(start)).toBe(true);
    expect(notify.mock.calls[0][0].metadata.locale).toBe(used);
  });

  it('has every step in every language, with the amount and no placeholder left', () => {
    for (const l of ['en', 'ru', 'pt', 'es'] as const) {
      for (const step of ['lead', 'due', 'mid', 'last'] as const) {
        const c = renewalCopy(step, l, {
          product: 'Plan',
          amount: '29 USD',
          periodEnd: new Date('2026-04-10T00:00:00Z'),
          lastDay: new Date('2026-04-17T00:00:00Z'),
          buyerConfirms: true,
        });
        expect(`${c.subject} ${c.body}`).toContain('29 USD');
        expect(`${c.subject}${c.body}${c.ctaLabel}`).not.toMatch(
          /undefined|null|\$\{|Invalid|\.\./,
        );
      }
    }
    const wallet = renewalCopy('due', 'en', {
      product: 'Plan',
      amount: '$29',
      periodEnd: new Date(),
      lastDay: new Date(),
      buyerConfirms: false,
    });
    expect(wallet.body).not.toContain('automatically');
    expect(renewalLocale(null)).toBe('en');
    expect(renewalAmount('199.0000', 'BRL', 'pt').replace(/\s/g, ' ')).toBe('R$ 199');
    expect(renewalAmount('29.9', 'USD', 'en')).toBe('$29.90');
    expect(renewalAmount('10990', 'CLP', 'es')).toMatch(/10\.990/);
  });

  it('asks nothing after the period when there are no grace days', () => {
    const sub = { currentPeriodEnd: new Date('2026-04-10T00:00:00Z'), price: { graceDays: 0 } };
    expect(reminderStep(sub, new Date('2026-04-09T00:00:00Z'))).toBe('lead');
    expect(reminderStep(sub, new Date('2026-04-10T00:00:00Z'))).toBeNull();
  });

  it('tells a service that billing renews a plan, only while it does', async () => {
    await plan();
    const service = new SubscriptionsService(prisma, {} as any, {} as any, {} as any, {} as any);
    const read = async () => ((await service.getUserSubscriptions(user)) as any)[0];
    expect(await read()).toMatchObject({ renewsByLink: true, billingRenews: true });
    delete process.env.SUBSCRIPTION_RENEWALS_ENABLED;
    expect(await read()).toMatchObject({ renewsByLink: true, billingRenews: false });
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true';
    await prisma.subscription.updateMany({
      where: { userId: user },
      data: { rail: 'LAVA', providerSubscriptionId: `c-${randomUUID()}` },
    });
    expect((await read()).billingRenews).toBe(false);
  });
});
