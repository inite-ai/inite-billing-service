import { Decimal } from '@prisma/client/runtime/library';
import { HodleAdapter } from '../src/adapters/hodle/hodle.adapter';
import { LavaAdapter } from '../src/adapters/lava/lava.adapter';
import { CryptoAdapter } from '../src/adapters/crypto/crypto.adapter';
import { CheckoutService } from '../src/checkout/checkout.service';
import { PayablePricesService } from '../src/checkout/payable-prices.service';
import { railRefuses } from '../src/checkout/payable';

/**
 * The page must not offer a rail that then refuses the order. These run the
 * real adapters, with only the network and the database replaced: a rule that
 * drifts from its adapter fails here.
 */
describe('what a rail takes', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const CURRENCIES = ['BRL', 'EUR', 'USD', 'RUB', 'MXN', 'ARS', 'CLP', 'COP'];
  const MODES = ['PAYMENT', 'SUBSCRIPTION'] as const;

  const harness = (price: any, providers: any[]) => {
    const prisma: any = {
      price: { findUnique: jest.fn().mockResolvedValue(price) },
      paymentProvider: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(providers.find((p) => p.code === where.code) ?? null),
        ),
        findMany: jest.fn().mockResolvedValue(providers),
      },
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
    // Reaching the provider means the adapter had no objection of its own.
    global.fetch = jest.fn().mockRejectedValue(new Error('REACHED_PROVIDER')) as any;
    return {
      prisma,
      adapters: {
        HODLE: new HodleAdapter(prisma),
        LAVA: new LavaAdapter(prisma),
        CRYPTO: new CryptoAdapter(prisma),
      } as Record<string, any>,
    };
  };

  const provider = (code: string, over: any = {}) => ({
    code,
    name: code,
    isActive: true,
    supportedModes: ['PAYMENT'],
    currencies: ['BRL'],
    config: { apiKey: 'placeholder-placeholder', asset: 'BRS', defaultOfferId: 'offer-dynamic' },
    ...over,
  });

  const reaches = async (adapter: any, input: any): Promise<boolean> => {
    try {
      await adapter.createPaymentIntent(input);
      return true;
    } catch (error: any) {
      return /REACHED_PROVIDER/.test(String(error?.message));
    }
  };

  const CASES = ['HODLE', 'LAVA'].flatMap((rail) =>
    CURRENCIES.flatMap((currency) =>
      MODES.flatMap((mode) =>
        [null, 'offer-own'].flatMap((offer) =>
          [true, false].map((dynamic) => ({ rail, currency, mode, offer, dynamic })),
        ),
      ),
    ),
  );

  it.each(CASES)(
    '$rail $currency $mode offer=$offer dynamic=$dynamic: the rule and the adapter agree',
    async ({ rail, currency, mode, offer, dynamic }) => {
      const metadata = offer ? { lavaOfferId: offer } : {};
      const price = {
        code: 'plan',
        amount: new Decimal(49),
        currency,
        interval: 'month',
        metadata,
        product: { type: 'subscription', metadata: {} },
      };
      const p = provider(rail, {
        config: {
          apiKey: 'placeholder-placeholder',
          asset: 'BRS',
          ...(dynamic ? { defaultOfferId: 'offer-dynamic' } : {}),
        },
      });
      const { adapters } = harness(price, [p]);
      const took = await reaches(adapters[rail], {
        orderId: 'order-1',
        amount: 49,
        currency,
        mode,
        metadata: { price_code: 'plan', email: 'buyer@example.com' },
      });
      const refused = railRefuses(p, {
        mode,
        currency,
        productType: 'subscription',
        priceMetadata: metadata,
      });
      expect({ took, refused: refused === null }).toEqual({ took, refused: took });
    },
  );

  const session = async (over: any, providers: any[], metadata: any = {}) => {
    const price = {
      id: 'p',
      code: 'plan',
      amount: new Decimal(49),
      currency: over.currency,
      interval: 'month',
      metadata,
      product: { code: 'plan', type: 'subscription', metadata: {}, serviceId: 's' },
    };
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
    prisma.paymentIntent = { findFirst: jest.fn().mockResolvedValue(null) };
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

  it('offers no PIX and no card for a BRL subscription without an offer', async () => {
    const s = await session({ currency: 'BRL' }, [provider('HODLE'), provider('LAVA')]);
    expect(s.paymentMethods).toEqual([]);
  });

  it('offers PIX for one BRL period', async () => {
    const s = await session({ currency: 'BRL', mode: 'PAYMENT' }, [provider('HODLE')]);
    expect(s.paymentMethods.map((m: any) => m.code)).toEqual(['HODLE']);
  });

  it('offers the card for a EUR subscription only when its price names an offer', async () => {
    const rails = [provider('LAVA')];
    expect((await session({ currency: 'EUR' }, rails)).paymentMethods).toEqual([]);
    const withOffer = await session({ currency: 'EUR' }, rails, { lavaOfferId: 'o' });
    expect(withOffer.paymentMethods.map((m: any) => m.code)).toEqual(['LAVA']);
  });

  it('never sends a provider credential to the page', async () => {
    const s = await session({ currency: 'BRL', mode: 'PAYMENT' }, [provider('HODLE')]);
    expect(JSON.stringify(s)).not.toContain('placeholder-placeholder');
    expect(s.paymentMethods[0]).not.toHaveProperty('config');
  });

  describe('the admin check', () => {
    const run = async (rows: any[], providers: any[], cryptoMethods = 0) => {
      const { prisma, adapters } = harness(null, providers);
      adapters.CRYPTO.listMethods = jest.fn().mockResolvedValue(Array(cryptoMethods).fill({}));
      prisma.price.findMany = jest.fn().mockResolvedValue(rows);
      return new PayablePricesService(prisma, {
        getAdapter: (code: string) => adapters[code],
      } as any).unpayable();
    };
    const row = (currency: string, over: any = {}) => ({
      code: `plan-${currency}`,
      amount: new Decimal(49),
      currency,
      interval: 'month',
      metadata: {},
      product: { code: 'plan', type: 'subscription', metadata: {} },
      ...over,
    });

    it('lists a plan no rail takes, with each rail’s reason', async () => {
      const r = await run([row('BRL'), row('EUR')], [provider('HODLE'), provider('LAVA')]);
      expect(r.prices).toMatchObject([
        {
          code: 'plan-BRL',
          state: 'nobody',
          reasons: { HODLE: 'one_time_only', LAVA: 'subscription_not_converted' },
        },
        { code: 'plan-EUR', state: 'nobody', reasons: { LAVA: 'no_subscription_offer' } },
      ]);
    });

    it('says when only crypto is left', async () => {
      const r = await run([row('EUR')], [provider('LAVA'), provider('CRYPTO')], 1);
      expect(r.prices[0].state).toBe('crypto_only');
    });

    it('leaves out what can be paid, and asks for active rows only', async () => {
      const ok = row('EUR', { metadata: { lavaOfferId: 'o' } });
      const book = row('BRL', { interval: null, product: { code: 'b', type: 'one_time' } });
      const r = await run([ok, book], [provider('HODLE'), provider('LAVA')]);
      expect(r).toEqual({ checked: 2, prices: [] });
    });

    it('lists everything when no provider is on', async () => {
      expect((await run([row('USD')], [])).prices).toHaveLength(1);
    });
  });
});
