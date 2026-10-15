import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CheckoutService, isGuestUserId } from '../src/checkout/checkout.service';
import { OrdersService } from '../src/orders/orders.service';

/**
 * mikefluff.com sells without accounts: it opens a checkout for a made-up
 * `mikefluff:<hex>` user. The hosted checkout page signs the buyer in, and the
 * order then belonged to someone else — every guest purchase ended on
 * "session not found". The first signed-in user to open an untouched guest
 * order now takes it over; everything else stays owner-only.
 */
describe('checkout: claiming a guest order', () => {
  const GUEST = 'mikefluff:0123456789abcdef0123456789abcdef';
  const BUYER = 'did:key:zGfHq2tTVk9z4eXgy1111111111111111111111111111';
  const OTHER = 'did:key:zGfHq2tTVk9z4eXgy2222222222222222222222222222';

  const makeOrder = (over: Record<string, any> = {}) => ({
    id: 'ord-1',
    userId: GUEST,
    status: 'created',
    amount: '20.0000',
    currency: 'USD',
    mode: 'PAYMENT',
    metadata: { successUrl: 'https://mikefluff.com/ok' },
    price: {
      id: 'price-1',
      code: 'course-usd',
      interval: null,
      product: {
        id: 'prod-1',
        serviceId: 'svc-mikefluff',
        name: 'Course',
        code: 'c',
        type: 'one_time',
        metadata: {},
      },
    },
    ...over,
  });

  const build = (order: any, opts: { intents?: number; updated?: number; after?: any } = {}) => {
    const prisma: any = {
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValue(opts.after ?? order),
        updateMany: jest.fn().mockResolvedValue({ count: opts.updated ?? 1 }),
      },
      paymentProvider: { findMany: jest.fn().mockResolvedValue([]) },
      paymentIntent: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(opts.intents ?? 0),
      },
    };
    const service = new CheckoutService(
      prisma,
      { getPriceByCode: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  };

  it('recognises namespaced guest ids only', () => {
    expect(isGuestUserId(GUEST)).toBe(true);
    expect(isGuestUserId(BUYER)).toBe(false);
    expect(isGuestUserId(undefined)).toBe(false);
  });

  it('hands an untouched guest order to the first user who opens it', async () => {
    const { service, prisma } = build(makeOrder());
    const session = await service.getSession('ord-1', BUYER);

    expect(session.sessionId).toBe('ord-1');
    expect(session.successUrl).toBe('https://mikefluff.com/ok');
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.order.updateMany.mock.calls[0][0];
    // Conditional on the guest still owning it, still `created`.
    expect(call.where).toEqual({ id: 'ord-1', userId: GUEST, status: 'created' });
    expect(call.data.userId).toBe(BUYER);
    // The selling service keeps its guest id; nothing else in metadata is lost.
    expect(call.data.metadata.guestUserId).toBe(GUEST);
    expect(call.data.metadata.successUrl).toBe('https://mikefluff.com/ok');
  });

  it('claims through refresh too', async () => {
    const { service, prisma } = build(makeOrder());
    await expect(service.refreshPayment('ord-1', BUYER)).resolves.toBeDefined();
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it("never hands over a real user's order", async () => {
    const { service, prisma } = build(makeOrder({ userId: OTHER }));
    await expect(service.getSession('ord-1', BUYER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.refreshPayment('ord-1', BUYER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.paySession('ord-1', BUYER, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('leaves the owner path alone', async () => {
    const { service, prisma } = build(makeOrder({ userId: BUYER }));
    await expect(service.getSession('ord-1', BUYER)).resolves.toBeDefined();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it.each(['pending', 'paid', 'failed', 'refunded'])(
    'refuses a guest order already %s',
    async (status) => {
      const { service, prisma } = build(makeOrder({ status }));
      await expect(service.getSession('ord-1', BUYER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    },
  );

  it('refuses a guest order with a payment already started', async () => {
    const { service, prisma } = build(makeOrder(), { intents: 1 });
    await expect(service.getSession('ord-1', BUYER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('a guest id cannot claim another guest order', async () => {
    const { service } = build(makeOrder());
    await expect(service.getSession('ord-1', 'other:abc')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('loses a race to another user: forbidden', async () => {
    const { service } = build(makeOrder(), {
      updated: 0,
      after: makeOrder({ userId: OTHER }),
    });
    await expect(service.getSession('ord-1', BUYER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('loses a race to itself (two tabs): still its order', async () => {
    const { service } = build(makeOrder(), {
      updated: 0,
      after: makeOrder({ userId: BUYER, metadata: { guestUserId: GUEST } }),
    });
    await expect(service.getSession('ord-1', BUYER)).resolves.toBeDefined();
  });

  it('a service key still sees its claimed order by id', async () => {
    const claimed = makeOrder({ userId: BUYER, metadata: { guestUserId: GUEST } });
    const prisma: any = {
      order: {
        findFirst: jest.fn().mockResolvedValue({ ...claimed, priceId: 'price-1', snapshot: {} }),
      },
    };
    const orders = new OrdersService(prisma);
    const out = await orders.getOrderById('ord-1', undefined, 'svc-mikefluff');
    expect(out.id).toBe('ord-1');
    expect(out.metadata?.guestUserId).toBe(GUEST);
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({
      id: 'ord-1',
      price: { product: { serviceId: 'svc-mikefluff' } },
    });
  });

  it("a service key gets 404 for another service's order", async () => {
    const prisma: any = { order: { findFirst: jest.fn().mockResolvedValue(null) } };
    const orders = new OrdersService(prisma);
    await expect(orders.getOrderById('ord-1', undefined, 'svc-other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
