import { FunnelService } from '../src/funnel/funnel.service';

/**
 * The abandoned-checkout sweep used to fetch every stale 'created' order (which
 * are never cleaned up) and run a funnelEvent lookup PER order — unbounded work
 * with an N+1 every 15 minutes. It now scans a bounded window, pages through it,
 * and checks existing events one batch at a time.
 */
describe('FunnelService.detectAbandonedCheckouts', () => {
  const mkOrder = (id: string) => ({
    id,
    userId: `u-${id}`,
    amount: 10,
    currency: 'USD',
    price: { product: { id: 'prod', serviceId: 'svc' } },
  });

  const build = (orders: any[], alreadyAbandonedIds: string[] = []) => {
    const orderFindMany = jest.fn(async ({ cursor, take }: any) => {
      // Simple cursor pagination over the provided orders array.
      const startIdx = cursor ? orders.findIndex((o) => o.id === cursor.id) + 1 : 0;
      return orders.slice(startIdx, startIdx + take);
    });
    const funnelFindMany = jest.fn(async ({ where }: any) => {
      const ids: string[] = where.orderId.in;
      return ids
        .filter((id) => alreadyAbandonedIds.includes(id))
        .map((id) => ({ orderId: id }));
    });
    const funnelCreate = jest.fn(async () => ({}));
    const prisma: any = {
      order: { findMany: orderFindMany },
      funnelEvent: { findMany: funnelFindMany, create: funnelCreate, findFirst: jest.fn() },
    };
    return { service: new FunnelService(prisma), orderFindMany, funnelFindMany, funnelCreate };
  };

  it('constrains the query to a bounded recent window', async () => {
    const { service, orderFindMany } = build([]);
    await service.detectAbandonedCheckouts();
    const where = orderFindMany.mock.calls[0][0].where;
    expect(where.status).toBe('created');
    expect(where.createdAt.gte).toBeInstanceOf(Date); // lower bound present (was unbounded)
    expect(where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('checks existing events per BATCH, not per order (no N+1)', async () => {
    const orders = Array.from({ length: 5 }, (_, i) => mkOrder(`o${i}`));
    const { service, funnelFindMany, funnelCreate } = build(orders);
    const n = await service.detectAbandonedCheckouts();
    expect(n).toBe(5);
    // One batch (5 < 200) → exactly one existence query, not five.
    expect(funnelFindMany).toHaveBeenCalledTimes(1);
    expect(funnelCreate).toHaveBeenCalledTimes(5);
  });

  it('skips orders that already have a checkout_abandoned event', async () => {
    const orders = [mkOrder('a'), mkOrder('b'), mkOrder('c')];
    const { service, funnelCreate } = build(orders, ['b']);
    const n = await service.detectAbandonedCheckouts();
    expect(n).toBe(2);
    const trackedIds = funnelCreate.mock.calls.map((c: any) => c[0].data.orderId);
    expect(trackedIds.sort()).toEqual(['a', 'c']);
  });

  it('pages through more than one batch and terminates', async () => {
    // 250 orders → batch of 200 then 50 → two order queries.
    const orders = Array.from({ length: 250 }, (_, i) => mkOrder(`o${String(i).padStart(3, '0')}`));
    const { service, orderFindMany, funnelCreate } = build(orders);
    const n = await service.detectAbandonedCheckouts();
    expect(n).toBe(250);
    expect(orderFindMany).toHaveBeenCalledTimes(2);
    expect(funnelCreate).toHaveBeenCalledTimes(250);
  });
});
