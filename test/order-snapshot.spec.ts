import { CheckoutService } from '../src/checkout/checkout.service';

/**
 * An order recorded only `price_id`, so what it was for was whatever the
 * catalogue says today. Renaming a product, repricing it, or changing a
 * subscription's interval rewrote the description of every order ever placed
 * against it — a receipt that changes after the fact, and a support
 * conversation where nobody can agree on what was sold.
 */
describe('order snapshot', () => {
  const price = {
    id: 'price-1',
    code: 'pro-monthly',
    productId: 'prod-1',
    amount: '20.0000',
    currency: 'USD',
    interval: 'month',
    trialDays: 7,
    product: {
      id: 'prod-1',
      code: 'pro',
      name: 'Pro Plan',
      type: 'subscription',
      isActive: true,
      serviceId: 'svc-a',
    },
  };

  const build = () => {
    const prisma: any = {
      order: {
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'order-1', ...data })),
        update: jest.fn(),
      },
    };
    const service = new CheckoutService(
      prisma,
      { getPriceByCode: jest.fn().mockResolvedValue(price) } as any,
      {} as any,
      { getAffiliateByCode: jest.fn(), trackReferral: jest.fn() } as any,
      {} as any,
      { track: jest.fn() } as any,
      { get: () => undefined } as any,
    );
    return { prisma, service };
  };

  it('records what was bought at the moment of buying', async () => {
    const { prisma, service } = build();

    await service.createSession('user-1', {
      priceCode: 'pro-monthly',
      mode: 'SUBSCRIPTION',
    } as any);

    const snapshot = prisma.order.create.mock.calls[0][0].data.snapshot;
    expect(snapshot).toMatchObject({
      priceCode: 'pro-monthly',
      priceAmount: '20.0000',
      currency: 'USD',
      interval: 'month',
      trialDays: 7,
      productCode: 'pro',
      productName: 'Pro Plan',
      productType: 'subscription',
      serviceId: 'svc-a',
    });
    expect(typeof snapshot.capturedAt).toBe('string');
  });

  it('survives a product with nothing optional set', async () => {
    const { prisma, service } = build();
    const catalog: any = (service as any).catalogService;
    catalog.getPriceByCode.mockResolvedValue({
      ...price,
      interval: null,
      trialDays: null,
      product: { ...price.product, type: 'one_time', serviceId: null },
    });

    await service.createSession('user-1', { priceCode: 'pro-monthly', mode: 'PAYMENT' } as any);

    expect(prisma.order.create.mock.calls[0][0].data.snapshot).toMatchObject({
      interval: null,
      trialDays: null,
      serviceId: null,
    });
  });
});
