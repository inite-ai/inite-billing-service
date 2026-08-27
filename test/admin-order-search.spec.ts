import { AdminOrdersService } from '../src/admin/services/admin-orders.service';

/**
 * The admin could only find an order by an exact `userId` — a UUID nobody has
 * when a customer writes in. These assert that what an operator actually holds
 * reaches the record.
 */
describe('AdminOrdersService.getOrders search', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';

  const build = () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { order: { findMany, count } } as any;
    const service = new AdminOrdersService(prisma, {} as any);
    return { service, findMany };
  };

  const whereOf = (findMany: jest.Mock) => findMany.mock.calls[0][0].where;

  it('leaves the query untouched when nothing is searched', async () => {
    const { service, findMany } = build();
    await service.getOrders({});
    expect(whereOf(findMany)).toEqual({});
  });

  it('still supports the exact userId filter it always had', async () => {
    const { service, findMany } = build();
    await service.getOrders({ userId: uuid });
    expect(whereOf(findMany).userId).toBe(uuid);
    expect(whereOf(findMany).OR).toBeUndefined();
  });

  it('matches an order id pasted as a UUID exactly, not by substring', async () => {
    const { service, findMany } = build();
    await service.getOrders({ search: uuid });
    expect(whereOf(findMany).OR).toEqual(expect.arrayContaining([{ id: uuid }, { userId: uuid }]));
  });

  it('matches an external order reference', async () => {
    const { service, findMany } = build();
    await service.getOrders({ search: 'order_1712' });
    expect(whereOf(findMany).OR).toEqual(
      expect.arrayContaining([{ externalId: { contains: 'order_1712', mode: 'insensitive' } }]),
    );
  });

  it('reaches the order through the payment reference the rail returned', async () => {
    const { service, findMany } = build();
    await service.getOrders({ search: 'pi_3Ox' });
    expect(whereOf(findMany).OR).toEqual(
      expect.arrayContaining([
        { paymentIntents: { some: { providerIntentId: { contains: 'pi_3Ox' } } } },
      ]),
    );
  });

  it('does not build an exact-id clause for a non-uuid term', async () => {
    const { service, findMany } = build();
    await service.getOrders({ search: 'order_1712' });
    expect(whereOf(findMany).OR).not.toEqual(expect.arrayContaining([{ id: 'order_1712' }]));
  });

  it('ignores whitespace-only input', async () => {
    const { service, findMany } = build();
    await service.getOrders({ search: '   ' });
    expect(whereOf(findMany).OR).toBeUndefined();
  });
});
