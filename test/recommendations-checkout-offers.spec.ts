import {
  RecommendationsService,
  isHiddenFromOffers,
} from '../src/recommendations/recommendations.service';
import { RecommendationsController } from '../src/recommendations/recommendations.controller';

/**
 * The checkout page of a 49 BRL book offered "Payment test (100 ₽ / $5)",
 * another site's book, and dollar prices. A checkout's offers come from the
 * same shop, never a test product, and only in the currency being paid.
 */
describe('checkout offers', () => {
  const product = (id: string, name: string, prices: Array<[string, string]>, extra: any = {}) => ({
    id,
    code: extra.code ?? id,
    name,
    serviceId: 'svc-mf',
    type: 'one_time',
    metadata: extra.metadata ?? {},
    service: { id: 'svc-mf', name: 'mikefluff' },
    prices: prices.map(([currency, amount], i) => ({
      id: `${id}-p${i}`,
      code: `${id}-${currency.toLowerCase()}`,
      currency,
      amount,
      interval: null,
    })),
  });

  const buildService = (catalog: any[]) => {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
      entitlement: { findMany: jest.fn().mockResolvedValue([]) },
      funnelEvent: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue(catalog) },
      // top sellers: everything in the catalogue; popularity: none
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce(catalog.map((p) => ({ product_id: p.id })))
        .mockResolvedValue([]),
    };
    return new RecommendationsService(prisma, { get: () => undefined } as any, {} as any);
  };

  it('offers only non-test products priced in the order currency', async () => {
    const service = buildService([
      product('book-money', 'Nobody Owns Money (book)', [
        ['USD', '9'],
        ['BRL', '49'],
      ]),
      product('usd-only', 'Course', [['USD', '19']]),
      product('payment-test', 'Payment test (100 ₽ / $5)', [['BRL', '5']]),
      product('hidden', 'Hidden', [['BRL', '5']], { metadata: { unlisted: true } }),
    ]);

    const offers = await service.getNextBestOffers('user-1', {
      surface: 'checkout',
      serviceId: 'svc-mf',
      currency: 'brl',
    });

    expect(offers.map((o) => [o.code, o.currency, o.amount])).toEqual([
      ['book-money', 'BRL', '49'],
    ]);
  });

  it('recognises test products by flag, code or name', () => {
    expect(isHiddenFromOffers({ code: 'payment-test', name: 'x' })).toBe(true);
    expect(isHiddenFromOffers({ code: 'x', name: 'Payment test (100 ₽ / $5)' })).toBe(true);
    expect(isHiddenFromOffers({ code: 'x', name: 'y', metadata: { test: true } })).toBe(true);
    expect(isHiddenFromOffers({ code: 'contest-pass', name: 'Latest tools' })).toBe(false);
    expect(
      isHiddenFromOffers({
        code: 'mikefluff-book-nobody-writes-code',
        name: 'Nobody Writes Code Anymore (book)',
      }),
    ).toBe(false);
  });

  describe('controller', () => {
    const build = (order: any) => {
      const recommendations = { getNextBestOffers: jest.fn().mockResolvedValue([]) };
      const prisma: any = { order: { findUnique: jest.fn().mockResolvedValue(order) } };
      return {
        recommendations,
        controller: new RecommendationsController(recommendations as any, prisma),
      };
    };
    const buyer = { userId: 'user-1', roles: [] } as any;

    it('scopes a buyer’s checkout to the order’s service and currency', async () => {
      const { controller, recommendations } = build({
        id: 's',
        userId: 'user-1',
        currency: 'BRL',
        price: { productId: 'prod-1', product: { serviceId: 'svc-mf' } },
      });
      await controller.forCheckout(buyer, 's');
      expect(recommendations.getNextBestOffers).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          serviceId: 'svc-mf',
          currency: 'BRL',
          sessionProductId: 'prod-1',
        }),
      );
    });

    it('offers nothing when the product belongs to no service', async () => {
      const { controller, recommendations } = build({
        id: 's',
        userId: 'user-1',
        currency: 'BRL',
        price: { productId: 'prod-1', product: { serviceId: null } },
      });
      await expect(controller.forCheckout(buyer, 's')).resolves.toEqual([]);
      expect(recommendations.getNextBestOffers).not.toHaveBeenCalled();
    });
  });
});
