import { CreditsService } from '../src/credits/credits.service';

/**
 * Credit grant/reset/refund must run INSIDE the caller's transaction when one is
 * passed (the payment-fulfilment tx), so credits commit or roll back atomically
 * with the order. Previously they always opened their own separate $transaction,
 * so a payment rollback left phantom credits and a grant failure was invisible
 * to the paid order.
 */
describe('CreditsService transaction threading', () => {
  const baseBalance = {
    id: 'bal-1',
    userId: 'user-1',
    serviceId: null,
    balance: 0,
    totalGranted: 0,
    totalUsed: 0,
    resetsAt: null,
  };

  const makeDb = () => ({
    creditBalance: {
      findUnique: jest.fn().mockResolvedValue(baseBalance),
      create: jest.fn().mockResolvedValue(baseBalance),
      update: jest.fn().mockResolvedValue({ ...baseBalance, balance: 100 }),
    },
    creditUsage: { create: jest.fn().mockResolvedValue({}) },
  });

  let mockPrisma: any;
  let ownTx: any; // the client Prisma would create if we opened our own tx
  let outerTx: any; // a caller-supplied transaction client
  let service: CreditsService;

  beforeEach(() => {
    ownTx = makeDb();
    outerTx = makeDb();
    mockPrisma = {
      $transaction: jest.fn((fn: any) => fn(ownTx)),
    };
    service = new CreditsService(mockPrisma);
  });

  describe.each([
    ['grant', () => service.grant({ userId: 'user-1', amount: 100 }, outerTx)],
    [
      'resetForPeriod',
      () =>
        service.resetForPeriod(
          { userId: 'user-1', newBalance: 100, resetsAt: new Date('2026-02-01') },
          outerTx,
        ),
    ],
    ['refund', () => service.refund({ userId: 'user-1', amount: 100, orderId: 'o1' }, outerTx)],
  ])('%s(data, tx)', (_name, call) => {
    it('runs on the passed tx and does NOT open its own transaction', async () => {
      await call();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(outerTx.creditBalance.update).toHaveBeenCalled();
      expect(ownTx.creditBalance.update).not.toHaveBeenCalled();
    });
  });

  it('propagates a failure inside the caller tx (no swallow) so the payment rolls back', async () => {
    outerTx.creditBalance.update.mockRejectedValue(new Error('constraint violation'));
    await expect(service.grant({ userId: 'user-1', amount: 100 }, outerTx)).rejects.toThrow(
      'constraint violation',
    );
  });

  it('still opens its own transaction when no tx is given (standalone use)', async () => {
    await service.grant({ userId: 'user-1', amount: 100 });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ownTx.creditBalance.update).toHaveBeenCalled();
    expect(outerTx.creditBalance.update).not.toHaveBeenCalled();
  });
});
