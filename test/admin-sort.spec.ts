import { resolveOrderBy } from '../src/common/helpers/sort';
import { AdminOrdersService, ORDER_SORT } from '../src/admin/services/admin-orders.service';
import {
  AdminAffiliatesService,
  PAYOUT_SORT,
} from '../src/admin/services/admin-affiliates.service';
import { AdminUsersService } from '../src/admin/services/admin-users.service';

/**
 * Sorting is a database concern here. Ordering the twenty rows already on
 * screen would put a page-local ranking under a header that claims to rank the
 * table, which is the same class of lie as a button that reports success
 * without sending a request.
 */
describe('resolveOrderBy', () => {
  it('falls back to the resource default when nothing is requested', () => {
    expect(resolveOrderBy(ORDER_SORT, { createdAt: 'desc' })).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('refuses a column that is not on the whitelist', () => {
    // An arbitrary string would otherwise reach Prisma as a column name.
    expect(resolveOrderBy(ORDER_SORT, { createdAt: 'desc' }, 'metadata->>secret', 'asc')).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('does not treat inherited object properties as sort keys', () => {
    // The whitelist is read through a Map built from its own entries, so a
    // prototype name is simply absent rather than a function to be called.
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(resolveOrderBy(ORDER_SORT, { createdAt: 'desc' }, key)).toEqual([
        { createdAt: 'desc' },
        { id: 'desc' },
      ]);
    }
  });

  it('honours a whitelisted column in both directions', () => {
    expect(resolveOrderBy(ORDER_SORT, { createdAt: 'desc' }, 'amount', 'asc')).toEqual([
      { amount: 'asc' },
      { id: 'asc' },
    ]);
    expect(resolveOrderBy(ORDER_SORT, { createdAt: 'desc' }, 'amount', 'desc')).toEqual([
      { amount: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('defaults an unreadable direction to desc rather than guessing', () => {
    expect(resolveOrderBy(ORDER_SORT, { createdAt: 'desc' }, 'amount', 'sideways')).toEqual([
      { amount: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('sorts through a relation when the column belongs to one', () => {
    expect(resolveOrderBy(PAYOUT_SORT, { createdAt: 'desc' }, 'affiliate', 'asc')).toEqual([
      { affiliate: { referralCode: 'asc' } },
      { id: 'asc' },
    ]);
  });

  it('always ends with an id tiebreaker so paging cannot repeat or skip a row', () => {
    const orderBy = resolveOrderBy(ORDER_SORT, { createdAt: 'desc' }, 'status', 'asc');
    expect(orderBy[orderBy.length - 1]).toEqual({ id: 'asc' });
  });
});

describe('admin list endpoints pass the sort to the database', () => {
  const buildOrders = () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { order: { findMany, count } } as any;
    return { service: new AdminOrdersService(prisma, {} as any), findMany };
  };

  it('orders the whole filtered set, not the current page', async () => {
    const { service, findMany } = buildOrders();
    await service.getOrders({ status: 'paid', page: 3, sortBy: 'amount', sortOrder: 'asc' });

    const args = findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ amount: 'asc' }, { id: 'asc' }]);
    expect(args.where).toEqual({ status: 'paid' });
    expect(args.skip).toBe(40);
  });

  it('sorts payouts by amount so the biggest money is checked first', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { affiliatePayout: { findMany, count } } as any;
    const service = new AdminAffiliatesService(prisma);

    await service.getPayouts({ status: 'pending', sortBy: 'totalAmount', sortOrder: 'desc' });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ totalAmount: 'desc' }, { id: 'desc' }]);
  });

  it('sorts customers by an aggregate, since the list is a groupBy', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const prisma = {
      order: { groupBy },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
      entitlement: { findMany: jest.fn().mockResolvedValue([]) },
      creditBalance: { findMany: jest.fn().mockResolvedValue([]) },
      affiliate: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new AdminUsersService(prisma);

    await service.getCustomers({ sortBy: 'totalSpent', sortOrder: 'desc' });
    expect(groupBy.mock.calls[0][0].orderBy).toEqual({ _sum: { amount: 'desc' } });
  });

  it('ignores an aggregate sort key the customer list does not offer', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const prisma = {
      order: { groupBy },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
      entitlement: { findMany: jest.fn().mockResolvedValue([]) },
      creditBalance: { findMany: jest.fn().mockResolvedValue([]) },
      affiliate: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new AdminUsersService(prisma);

    await service.getCustomers({ sortBy: 'amount' });
    expect(groupBy.mock.calls[0][0].orderBy).toEqual({ _max: { createdAt: 'desc' } });
  });
});
