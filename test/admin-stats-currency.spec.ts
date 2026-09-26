import { Prisma } from '@prisma/client';
import { AdminStatsService } from '../src/admin/services/admin-stats.service';

describe('AdminStatsService.getStats — per-currency totals', () => {
  const sum = (amount: string) => ({ _sum: { amount: new Prisma.Decimal(amount) } });
  const prisma = {
    order: {
      count: jest.fn().mockResolvedValue(3),
      aggregate: jest.fn().mockResolvedValue(sum('4569')),
      groupBy: jest.fn().mockResolvedValue([
        { currency: 'USD', ...sum('79') },
        { currency: 'RUB', ...sum('4490') },
      ]),
    },
    subscription: { count: jest.fn().mockResolvedValue(2) },
    affiliate: { count: jest.fn().mockResolvedValue(1) },
    affiliateCommission: {
      aggregate: jest.fn().mockResolvedValue(sum('12')),
      groupBy: jest.fn().mockResolvedValue([{ currency: 'USD', ...sum('12') }]),
    },
  };
  const service = new AdminStatsService(prisma as never);

  it('keeps the flat totals and adds revenue per currency, largest first', async () => {
    const stats = await service.getStats();

    expect(stats.totalRevenue).toBe('4569');
    expect(stats.revenueByCurrency).toEqual([
      { currency: 'RUB', amount: '4490' },
      { currency: 'USD', amount: '79' },
    ]);
    expect(stats.commissionsByCurrency).toEqual([{ currency: 'USD', amount: '12' }]);
  });

  it('groups only paid orders and settled commissions', async () => {
    await service.getStats();

    expect(prisma.order.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['currency'],
      where: { status: 'paid' },
    });
    expect(prisma.affiliateCommission.groupBy.mock.calls[0][0]).toMatchObject({
      where: { status: { in: ['earned', 'paid'] } },
    });
  });
});
