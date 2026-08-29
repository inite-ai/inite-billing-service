import { ConflictException } from '@nestjs/common';
import { CheckoutService } from '../src/checkout/checkout.service';

/**
 * An idempotency key exists so a double-clicked Pay button, or a client retry
 * after a timeout, cannot produce two orders. The check was a read, and the
 * write happened at the very end of session creation — so two requests
 * carrying the same key both read nothing and both created one.
 *
 * The claim is atomic now. The first request holds the key; a second while it
 * is in flight is told so, rather than being handed a second order. A failed
 * attempt releases the key so the client can retry at once instead of being
 * locked out for the whole TTL.
 */
describe('checkout idempotency', () => {
  const price = {
    id: 'price-1',
    productId: 'prod-1',
    amount: '20.0000',
    currency: 'USD',
    product: { id: 'prod-1', code: 'pro', isActive: true, type: 'one_time', serviceId: 'svc-a' },
  };

  const build = (overrides: any = {}) => {
    const orders: any[] = [];
    const prisma: any = {
      order: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          const order = { id: `order-${orders.length + 1}`, ...data };
          orders.push(order);
          return order;
        }),
        update: jest.fn(),
      },
      paymentProvider: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const catalog = {
      getPriceByCode: jest.fn().mockResolvedValue(overrides.price ?? price),
    };
    const service = new CheckoutService(
      prisma,
      catalog as any,
      {} as any, // orchestrator
      { getAffiliateByCode: jest.fn(), trackReferral: jest.fn() } as any,
      {} as any, // promo codes
      { track: jest.fn() } as any, // funnel
      { get: () => undefined } as any, // config — no REDIS_URL, in-process fallback
    );
    return { service, prisma, catalog, orders };
  };

  const dto = { priceCode: 'pro-monthly', mode: 'PAYMENT' } as any;

  it('returns the first session for a repeated key, without creating another order', async () => {
    const { service, prisma } = build();

    const first = await service.createSession('user-1', dto, 'key-1');
    const second = await service.createSession('user-1', dto, 'key-1');

    expect(second).toEqual(first);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a second request while the first is still creating the order', async () => {
    const { service, prisma, catalog } = build();
    // Hold the first request inside session creation.
    let release: () => void = () => undefined;
    catalog.getPriceByCode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(price);
        }),
    );

    const first = service.createSession('user-1', dto, 'key-1');
    await new Promise((r) => setImmediate(r));

    await expect(service.createSession('user-1', dto, 'key-1')).rejects.toBeInstanceOf(
      ConflictException,
    );

    release();
    await first;
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });

  it('releases the key when the attempt fails, so the client can retry', async () => {
    const { service, catalog } = build();
    catalog.getPriceByCode.mockRejectedValueOnce(new Error('catalog unavailable'));

    await expect(service.createSession('user-1', dto, 'key-1')).rejects.toThrow(
      'catalog unavailable',
    );

    // Not a ConflictException: the failed attempt let go of the key.
    await expect(service.createSession('user-1', dto, 'key-1')).resolves.toMatchObject({
      sessionId: 'order-1',
    });
  });

  it('keys are per user — one user cannot claim another’s', async () => {
    const { service, prisma } = build();

    await service.createSession('user-1', dto, 'key-1');
    await service.createSession('user-2', dto, 'key-1');

    expect(prisma.order.create).toHaveBeenCalledTimes(2);
  });

  it('creates one order per request when no key is supplied', async () => {
    const { service, prisma } = build();

    await service.createSession('user-1', dto);
    await service.createSession('user-1', dto);

    expect(prisma.order.create).toHaveBeenCalledTimes(2);
  });
});
