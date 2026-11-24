import { randomUUID } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { HodleAdapter } from '../src/adapters/hodle/hodle.adapter';
import { LavaAdapter } from '../src/adapters/lava/lava.adapter';
import { CryptoAdapter } from '../src/adapters/crypto/crypto.adapter';
import { StripeAdapter } from '../src/adapters/stripe/stripe.adapter';
import { OneAdapter } from '../src/adapters/one/one.adapter';
import { AppleIAPAdapter } from '../src/adapters/apple-iap/apple-iap.adapter';
import { GooglePlayAdapter } from '../src/adapters/google-play/google-play.adapter';
import { CheckoutService } from '../src/checkout/checkout.service';
import { PayabilityService } from '../src/checkout/payability.service';
import { quoteInput, railDecision } from '../src/checkout/rail-decision';
import { CatalogService } from '../src/catalog/catalog.service';
import { toMinorUnits, fromMinorUnits, roundToMinorUnits } from '../src/common/money';
import { billingDb, cleanBilling, makeIntent, makeOrder, makePlan } from './helpers/billing-db';

/**
 * A rail is offered only if it would take the order. The real adapters run
 * here with the network and the database replaced: what `quote` says is held
 * to whether `createPaymentIntent` reaches the provider.
 */
const realFetch = global.fetch;
const env = process.env.SUBSCRIPTION_RENEWALS_ENABLED;
afterEach(() => {
  global.fetch = realFetch;
  if (env === undefined) delete process.env.SUBSCRIPTION_RENEWALS_ENABLED;
  else process.env.SUBSCRIPTION_RENEWALS_ENABLED = env;
});

const CURRENCIES = ['BRL', 'EUR', 'USD', 'RUB', 'MXN', 'ARS', 'CLP', 'COP'];

const provider = (code: string, over: any = {}) => ({
  code,
  name: code,
  isActive: true,
  supportedModes: ['PAYMENT'],
  currencies: ['BRL'],
  config: {
    apiKey: 'placeholder-placeholder',
    apiSecret: 'placeholder-placeholder',
    secretKey: 'placeholder-placeholder',
    asset: 'BRS',
    defaultOfferId: 'offer-dynamic',
  },
  ...over,
});

function harness(price: any, providers: any[]) {
  const prisma: any = {
    price: {
      findUnique: jest.fn().mockResolvedValue(price),
      findMany: jest.fn().mockResolvedValue([]),
    },
    paymentProvider: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(providers.find((p) => p.code === where.code) ?? null),
      ),
      findMany: jest.fn().mockResolvedValue(providers),
    },
    paymentIntent: { findFirst: jest.fn().mockResolvedValue(null) },
    fxRate: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve({
          currency: where.currency,
          perUsd: new Decimal(5),
          source: 'open.er-api.com',
          publishedAt: new Date(),
          fetchedAt: new Date(),
        }),
      ),
    },
  };
  const bodies: any[] = [];
  // Reaching the provider means the adapter had no objection of its own.
  global.fetch = jest.fn(async (_url: any, init: any) => {
    bodies.push(init?.body);
    throw new Error('REACHED_PROVIDER');
  }) as any;
  const adapters: Record<string, any> = {
    HODLE: new HodleAdapter(prisma),
    LAVA: new LavaAdapter(prisma),
    CRYPTO: new CryptoAdapter(prisma),
    STRIPE: new StripeAdapter(prisma),
    ONE: new OneAdapter(prisma),
  };
  return { prisma, adapters, bodies };
}

const reaches = async (adapter: any, input: any): Promise<boolean> => {
  try {
    await adapter.createPaymentIntent(input);
    return true;
  } catch (error: any) {
    return /REACHED_PROVIDER/.test(String(error?.message));
  }
};

const planPrice = (over: any = {}) => ({
  id: 'p',
  code: 'plan',
  amount: new Decimal(49),
  currency: 'BRL',
  interval: 'month',
  metadata: {},
  product: { code: 'plan', type: 'subscription', metadata: {}, serviceId: 's' },
  ...over,
});

describe('quote and the adapter agree', () => {
  const cases = ['HODLE', 'LAVA', 'STRIPE', 'ONE'].flatMap((rail) =>
    CURRENCIES.flatMap((currency) =>
      ['month', 'year', 'quarter', 'day'].flatMap((interval) =>
        ['0.5', '49', '49.99'].flatMap((amount) =>
          [true, false].flatMap((recurring) =>
            [null, 'offer-own'].flatMap((offer) =>
              [true, false].flatMap((dynamic) =>
                [true, false].map((discounted) => ({
                  rail,
                  currency,
                  interval,
                  amount,
                  recurring,
                  offer,
                  dynamic,
                  discounted,
                })),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  it(`over ${cases.length} orders`, async () => {
    const disagree: any[] = [];
    for (const c of cases) {
      const amount = new Decimal(c.amount);
      const price = planPrice({
        currency: c.currency,
        interval: c.interval,
        amount: c.discounted ? amount.plus(1) : amount,
        metadata: c.offer ? { lavaOfferId: c.offer } : {},
      });
      const p = provider(c.rail);
      if (!c.dynamic) delete p.config.defaultOfferId;
      const { adapters } = harness(price, [p]);
      const mode = c.recurring ? 'SUBSCRIPTION' : 'PAYMENT';
      const quote = adapters[c.rail].quote(
        quoteInput({ amount, currency: c.currency, mode, price } as any),
        p,
      );
      const took = await reaches(adapters[c.rail], {
        orderId: 'order-1',
        amount: amount.toNumber(),
        exactAmount: amount.toFixed(),
        currency: c.currency,
        mode,
        ...(quote.ok ? { purpose: quote.purpose } : {}),
        metadata: { price_code: 'plan', email: 'buyer@example.com' },
      });
      if (took !== quote.ok) disagree.push({ ...c, quote, took });
    }
    expect(disagree).toEqual([]);
  });

  it('a rail with no key takes nothing, and says why', () => {
    for (const rail of ['HODLE', 'LAVA', 'STRIPE', 'ONE']) {
      const { adapters } = harness(null, []);
      const order = quoteInput({
        amount: '49',
        currency: 'BRL',
        mode: 'PAYMENT',
        price: planPrice(),
      } as any);
      const answer = adapters[rail].quote(order, provider(rail, { config: {} }));
      expect(answer).toEqual({ ok: false, reason: 'not_configured' });
    }
  });

  it('asking makes no call', () => {
    const { adapters, prisma } = harness(null, []);
    for (const rail of Object.keys(adapters)) {
      adapters[rail].quote(
        quoteInput({ amount: '49', currency: 'USD', mode: 'PAYMENT', price: planPrice() } as any),
        provider(rail),
      );
    }
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.paymentProvider.findUnique).not.toHaveBeenCalled();
  });

  it('an undecided caller still gets what its mode meant', async () => {
    const { adapters } = harness(planPrice(), [provider('HODLE')]);
    await expect(
      adapters.HODLE.createPaymentIntent({
        orderId: 'o',
        amount: 49,
        currency: 'BRL',
        mode: 'SUBSCRIPTION',
      }),
    ).rejects.toThrow('one-time payments only');
  });
});

describe('what a rail declares', () => {
  const all = [
    new HodleAdapter({} as any),
    new LavaAdapter({} as any),
    new CryptoAdapter({} as any),
    new StripeAdapter({} as any),
    new OneAdapter({} as any),
    new AppleIAPAdapter({} as any),
    new GooglePlayAdapter({} as any),
  ] as any[];

  it.each(all.map((a) => [a.rail(), a]))(
    '%s: provider_managed names each charge; only then may it be declared',
    (_rail, adapter) => {
      const managed = adapter.capabilities().collects?.includes('provider_managed') ?? false;
      expect(typeof adapter.readRenewal === 'function').toBe(managed);
    },
  );

  it.each(all.map((a) => [a.rail(), a]))(
    '%s refuses a webhook when it has no secret',
    async (_rail, adapter) => {
      const ok = await adapter.verifyWebhook({
        rawBody: Buffer.from('{}'),
        headers: {},
        config: {},
        payload: {},
      });
      expect(ok).toBe(false);
    },
  );
});

describe('money crosses the boundary exactly', () => {
  it.each([
    ['USD', '49.99', 4999],
    ['CLP', '10990', 10990],
    ['JPY', '980', 980],
    ['KWD', '1.234', 1234],
  ])('%s %s', (currency, amount, minor) => {
    expect(toMinorUnits(amount, currency)).toBe(minor);
    expect(fromMinorUnits(minor, currency).toString()).toBe(amount);
  });

  it('refuses a fraction of the smallest unit, and rounds one only when asked', () => {
    expect(() => toMinorUnits('10990.5', 'CLP')).toThrow();
    expect(roundToMinorUnits('16.9915', 'USD')).toBe(1699);
    expect(roundToMinorUnits('1.005', 'USD')).toBe(101);
  });

  it('Stripe is asked for pesos without cents, and PIX for the exact cents', async () => {
    const { adapters, bodies } = harness(planPrice(), [provider('STRIPE'), provider('HODLE')]);
    await reaches(adapters.STRIPE, {
      orderId: 'o',
      amount: 10990,
      exactAmount: '10990',
      currency: 'CLP',
      mode: 'PAYMENT',
    });
    expect(decodeURIComponent(String(bodies[0]))).toContain('unit_amount]=10990&');
    await reaches(adapters.HODLE, {
      orderId: 'o',
      amount: 1.005,
      exactAmount: '1.005',
      currency: 'BRL',
      mode: 'PAYMENT',
    });
    expect(JSON.parse(bodies[1]).value).toBe(101);
  });
});

describe('the checkout page', () => {
  const session = async (over: any, providers: any[], metadata: any = {}) => {
    const price = planPrice({ currency: over.currency, metadata });
    const { prisma, adapters } = harness(price, providers);
    prisma.order = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        userId: 'u',
        status: 'created',
        amount: new Decimal(49),
        metadata: {},
        mode: 'SUBSCRIPTION',
        price,
        ...over,
      }),
    };
    const service = new CheckoutService(
      prisma,
      {} as any,
      { getAdapter: (code: string) => adapters[code] } as any,
      {} as any,
      {} as any,
      {} as any,
      { get: () => undefined } as any,
    );
    return (await service.getSession('order-1', 'u')) as any;
  };
  const codes = (s: any) => s.paymentMethods.map((m: any) => m.code);

  it('offers no PIX and no card for a BRL plan while billing does not renew', async () => {
    const s = await session({ currency: 'BRL' }, [provider('HODLE'), provider('LAVA')]);
    expect(codes(s)).toEqual([]);
  });

  it('offers PIX for a BRL plan once it does, with the storefront unchanged', async () => {
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true';
    expect(codes(await session({ currency: 'BRL' }, [provider('HODLE')]))).toEqual(['HODLE']);
  });

  it('offers PIX for one BRL period either way', async () => {
    const s = await session({ currency: 'BRL', mode: 'PAYMENT' }, [provider('HODLE')]);
    expect(codes(s)).toEqual(['HODLE']);
  });

  it('never sends a provider credential to the page', async () => {
    const s = await session({ currency: 'BRL', mode: 'PAYMENT' }, [provider('HODLE')]);
    expect(JSON.stringify(s)).not.toContain('placeholder-placeholder');
    expect(s.paymentMethods[0]).not.toHaveProperty('config');
  });
});

describe('which prices can be paid', () => {
  const build = (providers: any[], cryptoMethods = 0) => {
    const { prisma, adapters } = harness(null, providers);
    adapters.CRYPTO.listMethods = jest.fn().mockResolvedValue(Array(cryptoMethods).fill({}));
    const service = new PayabilityService(prisma, { get: (c: string) => adapters[c] } as any);
    return { prisma, service };
  };
  const ask = async (service: PayabilityService, currency: string, over: any = {}) =>
    (await service.forPrices([planPrice({ currency, ...over })])).get('plan')!;

  it('the lava.top general offer counts the moment it is saved, with no restart', async () => {
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true';
    const lava = provider('LAVA');
    delete lava.config.defaultOfferId;
    const { service } = build([lava]);
    expect(await ask(service, 'USD')).toMatchObject({
      state: 'unpayable',
      reasons: { LAVA: 'no_general_offer' },
    });
    lava.config.defaultOfferId = 'offer-saved-by-the-owner';
    expect(await ask(service, 'USD')).toMatchObject({
      state: 'payable',
      collects: 'you_confirm',
      methods: [{ rail: 'LAVA', chargedIn: 'USD' }],
    });
    lava.config.defaultOfferId = '   ';
    expect((await ask(service, 'USD')).state).toBe('unpayable');
  });

  it('is not payable by a plan rail billing would not renew', async () => {
    const { service } = build([provider('HODLE')]);
    expect(await ask(service, 'BRL')).toMatchObject({
      state: 'unpayable',
      reasons: { HODLE: 'renewals_off' },
    });
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true';
    expect(await ask(service, 'BRL')).toMatchObject({ state: 'payable', collects: 'you_confirm' });
  });

  it('says when it would be charged in another currency', async () => {
    process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true';
    const { service } = build([provider('LAVA', { currencies: ['MXN'] })]);
    expect(await ask(service, 'MXN')).toMatchObject({
      state: 'payable_converted',
      methods: [{ rail: 'LAVA', chargedIn: 'USD' }],
    });
  });

  it('crypto alone counts in dollars and euros, and where it was ticked', async () => {
    const { service } = build([provider('CRYPTO', { currencies: ['COP'] })], 1);
    expect((await ask(service, 'USD')).state).toBe('payable');
    expect((await ask(service, 'EUR')).state).toBe('payable_converted');
    expect((await ask(service, 'CLP')).state).toBe('unpayable');
    expect((await ask(service, 'COP')).state).toBe('payable_converted');
  });

  it('lists for the admin what nobody takes, and what only crypto takes', async () => {
    const { service, prisma } = build([provider('LAVA'), provider('CRYPTO')], 1);
    prisma.price.findMany.mockResolvedValue([
      planPrice({ code: 'a', currency: 'CLP' }),
      planPrice({ code: 'b', currency: 'USD' }),
      planPrice({ code: 'c', currency: 'USD', metadata: { lavaOfferId: 'o' } }),
    ]);
    const { checked, prices } = await service.unpayable();
    expect(checked).toBe(3);
    expect(prices.map((p) => [p.code, p.state])).toEqual([
      ['a', 'nobody'],
      ['b', 'crypto_only'],
    ]);
  });

  it('never waits for an exchange rate source', async () => {
    const { prisma, adapters } = harness(null, []);
    prisma.paymentProvider.findMany.mockResolvedValue([provider('CRYPTO')]);
    prisma.paymentProvider.findUnique = jest
      .fn()
      .mockResolvedValue(
        provider('CRYPTO', { config: { wallets: { EVM: `0x${'1'.repeat(40)}` } } }),
      );
    prisma.fxRate.findUnique = jest.fn().mockResolvedValue(null);
    global.fetch = jest.fn(() => new Promise(() => undefined)) as any;
    const service = new PayabilityService(prisma, { get: (c: string) => adapters[c] } as any);
    const answer = await ask(service, 'EUR');
    expect(answer.reasons).toEqual({ CRYPTO: 'no_method' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('adds fields to the catalogue, drops none, and survives its own failure', async () => {
    const { prisma, service } = build([provider('HODLE')]);
    prisma.price.findMany.mockResolvedValue([
      { ...planPrice(), productId: 'x', graceDays: 3, isActive: true, createdAt: new Date() },
    ]);
    const [row] = await new CatalogService(prisma, service).getPrices();
    expect(row).toMatchObject({ code: 'plan', amount: '49', graceDays: 3, payable: false });
    jest.spyOn(service, 'forPrices').mockRejectedValue(new Error('down'));
    const [still] = await new CatalogService(prisma, service).getPrices();
    expect(still).toMatchObject({ code: 'plan', amount: '49' });
    expect(still).not.toHaveProperty('payable');
  });
});

describe('a plan bought by one-off payments', () => {
  const t = billingDb();
  afterAll(() => cleanBilling(t.prisma, t.run, t.user));

  it('through lava.top records no provider subscription, so billing renews it', async () => {
    const price = await makePlan(t.prisma, t.run);
    const order = await makeOrder(t.prisma, price, t.user);
    const intent = await makeIntent(t.prisma, order, { snapshot: { periodicity: 'ONE_TIME' } });
    await t.orchestrator.applyStateTransition(intent.id, 'paid');
    const sub = await t.prisma.subscription.findFirst({ where: { priceId: price.id } });
    expect(sub).toMatchObject({ rail: 'LAVA', providerSubscriptionId: null, status: 'active' });
  });

  it.each([{ periodicity: 'MONTHLY' }, {}])(
    'through a lava.top subscription keeps its contract (%p)',
    async (snapshot) => {
      const price = await makePlan(t.prisma, t.run);
      const order = await makeOrder(t.prisma, price, t.user);
      const id = `contract-${randomUUID()}`;
      const intent = await makeIntent(t.prisma, order, { snapshot, providerIntentId: id });
      await t.orchestrator.applyStateTransition(intent.id, 'paid');
      const sub = await t.prisma.subscription.findFirst({ where: { priceId: price.id } });
      expect(sub.providerSubscriptionId).toBe(id);
    },
  );
});

describe('crypto is left as it was', () => {
  it('sells a plan in any currency it has a rate for, renewals on or off', () => {
    const { adapters } = harness(null, []);
    for (const currency of CURRENCIES) {
      const order = quoteInput({
        amount: '49',
        currency,
        mode: 'SUBSCRIPTION',
        price: planPrice({ currency }),
      } as any);
      expect(railDecision(adapters.CRYPTO, provider('CRYPTO'), order)).toMatchObject({ ok: true });
    }
  });
});
