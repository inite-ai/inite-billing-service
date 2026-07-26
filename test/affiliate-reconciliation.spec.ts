import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { AdminAffiliatesService } from '../src/admin/services/admin-affiliates.service';

/**
 * Affiliate payout reconciliation (fixes the double-pay).
 *
 * The bug: manual withdrawal incremented Affiliate.totalPaid but left the
 * commissions it paid as `earned` with payoutId=null — so the monthly
 * AffiliatePayoutProcessor (which pays payoutId=null 'earned' commissions) paid
 * them a SECOND time, and a failed payout never restored the balance.
 *
 * The contract these tests pin:
 *  - a withdrawal LINKS the settled commissions it covers (payoutId + status
 *    'paid') so the monthly job can never re-pay them;
 *  - it is atomic (single $transaction over a row-locked affiliate);
 *  - failPayout reverses totalPaid AND releases the commissions, idempotently.
 */
describe('Affiliate payout reconciliation', () => {
  const configService = { get: () => 'https://app.inite.ai' } as any;
  const referralLevels = {} as any;

  const makeTx = (overrides: any = {}) => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    affiliate: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    affiliatePayout: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    affiliateCommission: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  });

  const prismaWith = (tx: any) => ({ $transaction: jest.fn((fn: any) => fn(tx)) }) as any;

  describe('requestWithdrawal', () => {
    const activeAffiliate = (totalEarned: number, totalPaid: number) => ({
      id: 'aff-1',
      status: 'active',
      totalEarned: new Decimal(totalEarned),
      totalPaid: new Decimal(totalPaid),
      service: { metadata: { minWithdrawalAmount: 5 } },
    });

    it('links every settled commission it covers and increments totalPaid by their sum', async () => {
      const commissions = [
        { id: 'c1', amount: new Decimal(10), earnedAt: new Date('2026-01-01'), currency: 'USD' },
        { id: 'c2', amount: new Decimal(5), earnedAt: new Date('2026-01-02'), currency: 'USD' },
      ];
      const tx = makeTx();
      tx.affiliate.findUnique.mockResolvedValue(activeAffiliate(15, 0));
      tx.affiliateCommission.findMany.mockResolvedValue(commissions);
      tx.affiliatePayout.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'payout-1', ...data }),
      );

      const svc = new AffiliatesService(prismaWith(tx), configService, referralLevels);
      const dto = await svc.requestWithdrawal('aff-1'); // no amount => full balance

      // Payout covers the full $15 (both commissions).
      const createArg = tx.affiliatePayout.create.mock.calls[0][0].data;
      expect(new Decimal(createArg.totalAmount).toNumber()).toBe(15);
      // Both commissions are linked + marked paid.
      expect(tx.affiliateCommission.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['c1', 'c2'] } },
        data: { payoutId: 'payout-1', status: 'paid' },
      });
      // totalPaid incremented by exactly the covered sum.
      const updArg = tx.affiliate.update.mock.calls[0][0];
      expect(new Decimal(updArg.data.totalPaid.increment).toNumber()).toBe(15);
      expect(dto.status).toBe('pending');
    });

    it('covers whole commissions up to the requested cap (indivisible, rounds down)', async () => {
      const commissions = [
        { id: 'c1', amount: new Decimal(10), earnedAt: new Date('2026-01-01'), currency: 'USD' },
        { id: 'c2', amount: new Decimal(8), earnedAt: new Date('2026-01-02'), currency: 'USD' },
      ];
      const tx = makeTx();
      tx.affiliate.findUnique.mockResolvedValue(activeAffiliate(18, 0));
      tx.affiliateCommission.findMany.mockResolvedValue(commissions);
      tx.affiliatePayout.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'payout-1', ...data }),
      );

      const svc = new AffiliatesService(prismaWith(tx), configService, referralLevels);
      await svc.requestWithdrawal('aff-1', 12); // cap 12 -> covers only c1 ($10), not c1+c2 ($18)

      const createArg = tx.affiliatePayout.create.mock.calls[0][0].data;
      expect(new Decimal(createArg.totalAmount).toNumber()).toBe(10);
      expect(tx.affiliateCommission.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['c1'] } },
        data: { payoutId: 'payout-1', status: 'paid' },
      });
    });

    it('rejects when a payout is already pending (inside the lock)', async () => {
      const tx = makeTx();
      tx.affiliate.findUnique.mockResolvedValue(activeAffiliate(15, 0));
      tx.affiliatePayout.findFirst.mockResolvedValue({ id: 'existing' });

      const svc = new AffiliatesService(prismaWith(tx), configService, referralLevels);
      await expect(svc.requestWithdrawal('aff-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.affiliatePayout.create).not.toHaveBeenCalled();
      expect(tx.affiliate.update).not.toHaveBeenCalled();
    });

    it('rejects when the requested amount exceeds the available balance', async () => {
      const tx = makeTx();
      tx.affiliate.findUnique.mockResolvedValue(activeAffiliate(15, 0));

      const svc = new AffiliatesService(prismaWith(tx), configService, referralLevels);
      await expect(svc.requestWithdrawal('aff-1', 1000)).rejects.toThrow(/Insufficient balance/);
      expect(tx.affiliatePayout.create).not.toHaveBeenCalled();
    });

    it('rejects when the covered sum is below the minimum withdrawal', async () => {
      const tx = makeTx();
      tx.affiliate.findUnique.mockResolvedValue(activeAffiliate(3, 0)); // min is 5
      tx.affiliateCommission.findMany.mockResolvedValue([
        { id: 'c1', amount: new Decimal(3), earnedAt: new Date('2026-01-01'), currency: 'USD' },
      ]);

      const svc = new AffiliatesService(prismaWith(tx), configService, referralLevels);
      await expect(svc.requestWithdrawal('aff-1')).rejects.toThrow(/Minimum withdrawal/);
      expect(tx.affiliate.update).not.toHaveBeenCalled();
    });
  });

  describe('failPayout reversal', () => {
    it('releases linked commissions and reverses totalPaid', async () => {
      const tx = makeTx();
      tx.affiliatePayout.findUnique.mockResolvedValue({
        id: 'payout-1',
        affiliateId: 'aff-1',
        status: 'pending',
        totalAmount: new Decimal(15),
      });
      tx.affiliatePayout.update.mockResolvedValue({ id: 'payout-1', status: 'failed' });

      const svc = new AdminAffiliatesService(prismaWith(tx));
      await svc.failPayout('payout-1', 'bank rejected');

      // Commissions released back to withdrawable state.
      expect(tx.affiliateCommission.updateMany).toHaveBeenCalledWith({
        where: { payoutId: 'payout-1' },
        data: { payoutId: null, status: 'earned' },
      });
      // Balance restored.
      const updArg = tx.affiliate.update.mock.calls[0][0];
      expect(new Decimal(updArg.data.totalPaid.decrement).toNumber()).toBe(15);
      expect(tx.affiliatePayout.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
      );
    });

    it('is idempotent — a already-failed payout is not reversed twice', async () => {
      const tx = makeTx();
      tx.affiliatePayout.findUnique.mockResolvedValue({
        id: 'payout-1',
        affiliateId: 'aff-1',
        status: 'failed',
        totalAmount: new Decimal(15),
      });

      const svc = new AdminAffiliatesService(prismaWith(tx));
      await svc.failPayout('payout-1');

      expect(tx.affiliateCommission.updateMany).not.toHaveBeenCalled();
      expect(tx.affiliate.update).not.toHaveBeenCalled();
    });

    it('refuses to fail a payout that has already been paid out', async () => {
      const tx = makeTx();
      tx.affiliatePayout.findUnique.mockResolvedValue({
        id: 'payout-1',
        affiliateId: 'aff-1',
        status: 'paid',
        totalAmount: new Decimal(15),
      });

      const svc = new AdminAffiliatesService(prismaWith(tx));
      await expect(svc.failPayout('payout-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.affiliate.update).not.toHaveBeenCalled();
    });
  });
});
