import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdminAffiliatesService } from '../src/admin/services/admin-affiliates.service';
import { AdminStatsService } from '../src/admin/services/admin-stats.service';
import { BulkPayoutDto } from '../src/admin/dto/affiliate-admin.dto';

const uuid = (n: number) => `550e8400-e29b-41d4-a716-44665544000${n}`;

/**
 * A bulk action is many independent decisions, not one. These pin the part
 * that matters to an operator: one bad row must not swallow the rest, and the
 * response has to say which row was bad.
 */
describe('AdminAffiliatesService.bulkPayoutAction', () => {
  const build = () => {
    const service = new AdminAffiliatesService({} as any);
    return service;
  };

  it('reports each payout separately instead of failing the batch', async () => {
    const service = build();
    jest
      .spyOn(service, 'processPayout')
      .mockResolvedValueOnce({ status: 'paid' } as any)
      .mockRejectedValueOnce(new Error('Payout is not in pending status'))
      .mockResolvedValueOnce({ status: 'paid' } as any);

    const res = await service.bulkPayoutAction({
      ids: [uuid(1), uuid(2), uuid(3)],
      action: 'process',
    });

    expect(res).toMatchObject({ requested: 3, succeeded: 2, failed: 1 });
    expect(res.results[1]).toEqual({
      id: uuid(2),
      ok: false,
      error: 'Payout is not in pending status',
    });
  });

  it('passes the operator reason through when failing payouts', async () => {
    const service = build();
    const fail = jest.spyOn(service, 'failPayout').mockResolvedValue({ status: 'failed' } as any);

    await service.bulkPayoutAction({
      ids: [uuid(1)],
      action: 'fail',
      reason: 'bank rejected the batch',
    });

    expect(fail).toHaveBeenCalledWith(uuid(1), 'bank rejected the batch');
  });

  it('works one payout at a time, because failing one reverses a shared balance', async () => {
    const service = build();
    const order: string[] = [];
    jest.spyOn(service, 'failPayout').mockImplementation(async (id: string) => {
      order.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, 1));
      order.push(`end:${id}`);
      return { status: 'failed' } as any;
    });

    await service.bulkPayoutAction({ ids: [uuid(1), uuid(2)], action: 'fail' });

    expect(order).toEqual([
      `start:${uuid(1)}`,
      `end:${uuid(1)}`,
      `start:${uuid(2)}`,
      `end:${uuid(2)}`,
    ]);
  });
});

describe('BulkPayoutDto', () => {
  const check = async (payload: any) => validate(plainToInstance(BulkPayoutDto, payload));

  it('rejects an empty selection', async () => {
    expect(await check({ ids: [], action: 'process' })).not.toHaveLength(0);
  });

  it('rejects a selection containing something that is not an id', async () => {
    expect(await check({ ids: [uuid(1), 'all'], action: 'process' })).not.toHaveLength(0);
  });

  it('rejects an action the service does not implement', async () => {
    expect(await check({ ids: [uuid(1)], action: 'delete' })).not.toHaveLength(0);
  });

  it('caps the batch size', async () => {
    const ids = Array.from({ length: 201 }, () => uuid(1));
    expect(await check({ ids, action: 'process' })).not.toHaveLength(0);
  });

  it('accepts a well-formed selection', async () => {
    expect(await check({ ids: [uuid(1), uuid(2)], action: 'fail', reason: 'x' })).toHaveLength(0);
  });
});

describe('AdminStatsService.getTriage', () => {
  it('counts only what an operator can act on today', async () => {
    const prisma = {
      affiliatePayout: {
        count: jest.fn().mockResolvedValue(4),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: '1250.0000' } }),
      },
      riskAssessment: { count: jest.fn().mockResolvedValue(2) },
      webhookEvent: { count: jest.fn().mockResolvedValue(1) },
      subscription: { count: jest.fn().mockResolvedValue(7) },
      order: { count: jest.fn().mockResolvedValue(3) },
      outboxEvent: { count: jest.fn().mockResolvedValue(0) },
    } as any;

    const triage = await new AdminStatsService(prisma).getTriage();

    expect(triage).toMatchObject({
      pendingPayouts: 4,
      pendingPayoutAmount: '1250.0000',
      flaggedRisk: 2,
      failedWebhooks: 1,
      pastDueSubscriptions: 7,
      staleOpenOrders: 3,
      failedOutbox: 0,
    });

    // An unpaid order minutes old is a live checkout, not a stuck one.
    const orderWhere = prisma.order.count.mock.calls[0][0].where;
    expect(orderWhere.status).toEqual({ in: ['created', 'open'] });
    expect(orderWhere.createdAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - 24 * 3600 * 1000);
  });
});
