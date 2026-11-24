import { CheckoutService } from '../src/checkout/checkout.service';
import { needsCountryProof, railProvesCountry } from '../src/checkout/currency-proof';

/**
 * Plan prices in Latin American currencies are below the dollar price, and the
 * reader chooses the currency. What is charged must not follow that choice
 * alone: without proof of the country, the local price is refused.
 */
describe('country proof for local plan prices', () => {
  const env = process.env.LOCAL_CURRENCY_PROOF_ENABLED;
  afterEach(() => {
    if (env === undefined) delete process.env.LOCAL_CURRENCY_PROOF_ENABLED;
    else process.env.LOCAL_CURRENCY_PROOF_ENABLED = env;
  });

  const build = (over: Record<string, any> = {}, type = 'subscription') => {
    const order = {
      id: 'order-1',
      userId: 'did:key:a',
      status: 'created',
      mode: 'PAYMENT',
      amount: '249',
      currency: 'BRL',
      externalId: 'order_x',
      metadata: {},
      price: {
        id: 'p-1',
        code: 'plan-monthly-brl',
        currency: 'BRL',
        interval: 'month',
        productId: 'prod-1',
        product: { code: 'plan', type, serviceId: 's' },
      },
      ...over,
    };
    const adapter = {
      capabilities: () => ({ supportedModes: ['PAYMENT'] }),
      createPaymentIntent: jest
        .fn()
        .mockResolvedValue({ providerIntentId: 'pi', checkoutUrl: 'https://pay.example/x' }),
    };
    const prisma: any = {
      order: { findUnique: jest.fn().mockResolvedValue(order), update: jest.fn() },
      price: { findFirst: jest.fn().mockResolvedValue({ code: 'plan-monthly' }) },
      paymentProvider: {
        findFirst: jest.fn().mockResolvedValue({ code: 'CRYPTO' }),
        findMany: jest.fn().mockResolvedValue(
          ['CRYPTO', 'HODLE', 'LAVA', 'STRIPE'].map((code) => ({
            code,
            name: code,
            supportedModes: ['PAYMENT'],
            currencies: ['BRL'],
          })),
        ),
      },
      paymentIntent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'intent-1', checkoutUrl: 'https://pay.example/x' }),
      },
    };
    const promo = { validatePromoCode: jest.fn() };
    const service = new CheckoutService(
      prisma,
      {} as any,
      { getAdapter: () => adapter } as any,
      {} as any,
      promo as any,
      { track: jest.fn() } as any,
      { get: () => undefined } as any,
    );
    return { service, prisma, adapter, promo };
  };
  const pay = (s: CheckoutService, data: any) =>
    s.paySession('order-1', 'did:key:a', data, 'buyer@example.com');
  const refused = { response: { code: 'currency_needs_country_proof' } };

  it.each(['CRYPTO', 'LAVA', 'STRIPE', 'UNKNOWN', undefined])(
    'refuses a BRL plan on %s and names the dollar price',
    async (rail) => {
      process.env.LOCAL_CURRENCY_PROOF_ENABLED = 'true';
      const { service, adapter } = build();
      await expect(pay(service, { rail })).rejects.toMatchObject({
        response: { code: 'currency_needs_country_proof', usdPriceCode: 'plan-monthly' },
      });
      expect(adapter.createPaymentIntent).not.toHaveBeenCalled();
    },
  );

  it.each(['MXN', 'ARS', 'CLP', 'COP'])('refuses a %s plan on every rail of today', async (c) => {
    process.env.LOCAL_CURRENCY_PROOF_ENABLED = 'true';
    for (const rail of ['CRYPTO', 'LAVA', 'HODLE', 'STRIPE', 'ONE']) {
      await expect(pay(build({ currency: c }).service, { rail })).rejects.toMatchObject(refused);
    }
  });

  it('charges a BRL plan by PIX', async () => {
    process.env.LOCAL_CURRENCY_PROOF_ENABLED = 'true';
    const { service, adapter } = build();
    await pay(service, { rail: 'HODLE' });
    expect(adapter.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('does not use up a promo code on a refused payment', async () => {
    process.env.LOCAL_CURRENCY_PROOF_ENABLED = 'true';
    const { service, promo } = build();
    await expect(pay(service, { rail: 'CRYPTO', promoCode: 'X' })).rejects.toMatchObject(refused);
    expect(promo.validatePromoCode).not.toHaveBeenCalled();
  });

  it('is not opened by a renewal marker the caller put in metadata', async () => {
    process.env.LOCAL_CURRENCY_PROOF_ENABLED = 'true';
    const { service } = build({
      metadata: { subscriptionRenewal: { subscriptionId: 's', periodEnd: 'x' }, country: 'BR' },
    });
    await expect(pay(service, { rail: 'CRYPTO' })).rejects.toMatchObject(refused);
  });

  it.each(['billing_renewal_s_2026', 'plan_change_s_u'])(
    'holds %s to the same proof, and takes PIX for it',
    async (externalId) => {
      process.env.LOCAL_CURRENCY_PROOF_ENABLED = 'true';
      await expect(pay(build({ externalId }).service, { rail: 'CRYPTO' })).rejects.toMatchObject(
        refused,
      );
      const { service, adapter } = build({ externalId });
      await pay(service, { rail: 'HODLE' });
      expect(adapter.createPaymentIntent).toHaveBeenCalledTimes(1);
    },
  );

  it('a forged post of a local price code opens an order but is never charged', async () => {
    process.env.LOCAL_CURRENCY_PROOF_ENABLED = 'true';
    for (const currency of ['COP', 'ARS', 'MXN', 'CLP', 'BRL']) {
      const { service, prisma, adapter } = build();
      const price = {
        id: 'p-1',
        code: `plan-monthly-${currency.toLowerCase()}`,
        currency,
        amount: '119900',
        interval: 'month',
        productId: 'prod-1',
        product: {
          id: 'prod-1',
          code: 'plan',
          type: 'subscription',
          isActive: true,
          serviceId: 's',
        },
      };
      (service as any).catalogService = { getPriceByCode: jest.fn().mockResolvedValue(price) };
      prisma.order.create = jest.fn(({ data }: any) => ({ id: 'order-1', ...data }));
      await service.createSession('did:key:a', {
        priceCode: price.code,
        mode: 'PAYMENT',
        metadata: { country: 'CO', 'cf-ipcountry': 'CO', taxId: '900123456', cardCountry: 'CO' },
      } as any);
      const order = { ...prisma.order.create.mock.calls[0][0].data, id: 'order-1', price };
      prisma.order.findUnique.mockResolvedValue(order);
      for (const rail of ['CRYPTO', 'LAVA', 'STRIPE', 'ONE', undefined]) {
        await expect(
          pay(service, { rail, method: 'CARD', country: currency.slice(0, 2) }),
        ).rejects.toMatchObject(refused);
      }
      expect(adapter.createPaymentIntent).not.toHaveBeenCalled();
    }
  });

  it('says there is no dollar price when none is on sale', async () => {
    process.env.LOCAL_CURRENCY_PROOF_ENABLED = 'true';
    const { service, prisma } = build();
    prisma.price.findFirst.mockResolvedValue(null);
    await expect(pay(service, { rail: 'CRYPTO' })).rejects.toMatchObject({
      response: { usdPriceCode: null },
    });
  });

  it('offers only PIX on the page for a BRL plan', async () => {
    process.env.LOCAL_CURRENCY_PROOF_ENABLED = 'true';
    const session: any = await build().service.getSession('order-1', 'did:key:a');
    expect(session.paymentMethods.map((m: any) => m.code)).toEqual(['HODLE']);
  });

  it('changes nothing while off', async () => {
    delete process.env.LOCAL_CURRENCY_PROOF_ENABLED;
    const { service, adapter } = build();
    await pay(service, { rail: 'CRYPTO' });
    expect(adapter.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('leaves one-time items, and free currencies alone', () => {
    const plan = { currency: 'BRL', productType: 'subscription' };
    expect(needsCountryProof(plan)).toBe(true);
    expect(needsCountryProof({ ...plan, productType: 'one_time' })).toBe(false);
    expect(needsCountryProof({ ...plan, currency: 'ars', productType: 'one_time' })).toBe(false);
    for (const currency of ['USD', 'EUR', 'RUB']) {
      expect(needsCountryProof({ ...plan, currency })).toBe(false);
    }
    expect(railProvesCountry('HODLE', 'MXN')).toBe(false);
  });
});
