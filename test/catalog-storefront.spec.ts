import { CatalogService } from '../src/catalog/catalog.service';
import { Prisma } from '@prisma/client';

const price = (id: string, amount: string, extra: Record<string, unknown> = {}) => ({
  id,
  productId: 'p',
  code: id,
  currency: 'USD',
  amount: new Prisma.Decimal(amount),
  interval: null,
  trialDays: 0,
  graceDays: 0,
  isActive: true,
  metadata: {},
  ...extra,
});

const product = (
  id: string,
  serviceId: string,
  metadata: Record<string, unknown>,
  prices: unknown[],
) => ({
  id,
  code: id,
  name: id,
  serviceId,
  moduleScope: id,
  type: 'one_time',
  isActive: true,
  metadata,
  prices,
});

describe('CatalogService.getStorefront', () => {
  const prisma = {
    service: {
      findMany: jest.fn().mockResolvedValue([
        { id: 's1', code: 'content', name: 'content', metadata: { displayName: 'INITE Content' } },
        { id: 's2', code: 'brain', name: 'Brain', metadata: {} },
      ]),
    },
    product: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          product('pack', 's1', {}, [price('pack-500', '15', { metadata: { credits: 500 } })]),
          product('smoke', 's1', { unlisted: true }, [price('smoke-usd', '5')]),
          product('priceless', 's1', {}, []),
        ]),
    },
  };
  const service = new CatalogService(prisma as never);

  it('groups listed products under their service and drops the rest', async () => {
    const { services } = await service.getStorefront();

    expect(services.map((s) => s.code)).toEqual(['content']);
    expect(services[0].products.map((p) => p.code)).toEqual(['pack']);
    expect(services[0].name).toBe('INITE Content');
  });

  it('carries price metadata and amounts as strings', async () => {
    const { services } = await service.getStorefront();
    const [pack] = services[0].products[0].prices!;

    expect(pack.amount).toBe('15');
    expect(pack.metadata).toEqual({ credits: 500 });
  });

  it('asks only for active services, products and prices', async () => {
    await service.getStorefront();

    expect(prisma.service.findMany.mock.calls[0][0].where).toEqual({ isActive: true });
    const productQuery = prisma.product.findMany.mock.calls[0][0];
    expect(productQuery.where).toEqual({ isActive: true, serviceId: { not: null } });
    expect(productQuery.include.prices.where).toEqual({ isActive: true });
  });
});
