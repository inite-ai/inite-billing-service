import { Decimal } from '@prisma/client/runtime/library';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { CommissionSettlementScheduler } from '../src/affiliates/commission-settlement.scheduler';
import { AffiliatePayoutProcessor } from '../src/affiliates/affiliate-payout.processor';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { currencyBalances } from '../src/affiliates/affiliate-ledger';

/**
 * The affiliate ledger, and the four ways it used to lie.
 *
 * 1. A refund voided the commission but left the credit it had added to
 *    `totalEarned` standing, so every refund raised the balance the affiliate
 *    appeared to be owed — and the withdrawal path authorised against exactly
 *    that number.
 * 2. Settlement flipped the commission to 'earned' and credited `totalEarned` in
 *    two separate statements with no transaction. Interrupted between them, the
 *    commission was settled and the credit lost forever: the flip is what makes
 *    a commission skipped on the next pass.
 * 3. `totalEarned` / `totalPaid` are single scalars, so a €10 and a $10
 *    commission added to €/$20 of nothing, and a USD withdrawal shrank a EUR
 *    balance.
 * 4. The monthly payout announced itself through an outbox row written outside
 *    the payout's own transaction — a rollback left subscribers told about a
 *    payout that does not exist.
 */
describe('affiliate ledger', () => {
  const configService = { get: () => 'https://app.inite.ai' } as any;
  const referralLevels = {} as any;

  const groupRows = (rows: Array<[string, string, number]>) =>
    rows.map(([currency, status, amount]) => ({
      currency,
      status,
      _sum: { amount: new Decimal(amount) },
    }));

  describe('balances are per currency and forget voided commissions', () => {
    it('never adds two currencies together', async () => {
      const db = {
        affiliateCommission: {
          groupBy: jest.fn().mockResolvedValue(
            groupRows([
              ['USD', 'earned', 30],
              ['USD', 'paid', 12],
              ['EUR', 'earned', 7],
              ['EUR', 'pending', 4],
            ]),
          ),
        },
      } as any;

      const balances = await currencyBalances(db, 'aff-1');

      expect(balances).toEqual([
        {
          currency: 'EUR',
          pending: '4.0000',
          available: '7.0000',
          earned: '7.0000',
          paid: '0.0000',
        },
        {
          currency: 'USD',
          pending: '0.0000',
          available: '30.0000',
          earned: '42.0000',
          paid: '12.0000',
        },
      ]);
    });

    it('excludes voided commissions from the query entirely', async () => {
      const db = { affiliateCommission: { groupBy: jest.fn().mockResolvedValue([]) } } as any;
      await currencyBalances(db, 'aff-1');

      const where = db.affiliateCommission.groupBy.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['pending', 'earned', 'paid'] });
    });

    it('canWithdraw asks each currency on its own, not the roll-up', async () => {
      // $3 and €3 clear a $5 minimum only if you are willing to add dollars to
      // euros. Nothing can be withdrawn here.
      const prisma = {
        affiliate: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'aff-1',
            totalEarned: new Decimal(6),
            totalPaid: new Decimal(0),
            service: { metadata: { minWithdrawalAmount: 5 } },
          }),
        },
        affiliateCommission: {
          groupBy: jest.fn().mockResolvedValue(
            groupRows([
              ['USD', 'earned', 3],
              ['EUR', 'earned', 3],
            ]),
          ),
        },
      } as any;

      const svc = new AffiliatesService(prisma, configService, referralLevels);
      const balance = await svc.getBalance('aff-1');

      expect(balance.canWithdraw).toBe(false);
      expect(balance.balances.map((b) => b.currency)).toEqual(['EUR', 'USD']);
    });
  });

  describe('withdrawal is authorised by the ledger, in one currency', () => {
    const txFor = (available: Decimal) => {
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        affiliate: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'aff-1',
            status: 'active',
            // Deliberately generous: the scalars say there is plenty. They are
            // not what decides.
            totalEarned: new Decimal(1000),
            totalPaid: new Decimal(0),
            service: { metadata: { minWithdrawalAmount: 5 } },
          }),
          update: jest.fn(),
        },
        affiliatePayout: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
        affiliateCommission: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn(),
          aggregate: jest.fn().mockResolvedValue({ _sum: { amount: available } }),
        },
      };
      return tx;
    };

    it('refuses a withdrawal in a currency with no settled commissions', async () => {
      const tx = txFor(new Decimal(0));
      const svc = new AffiliatesService(
        { $transaction: jest.fn((fn: any) => fn(tx)) } as any,
        configService,
        referralLevels,
      );

      await expect(svc.requestWithdrawal('aff-1', undefined, 'EUR')).rejects.toThrow(
        /Nothing to withdraw in EUR/,
      );
      expect(tx.affiliateCommission.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ currency: 'EUR' }) }),
      );
    });

    it('caps the payout at that currency alone', async () => {
      const tx = txFor(new Decimal(10));
      const svc = new AffiliatesService(
        { $transaction: jest.fn((fn: any) => fn(tx)) } as any,
        configService,
        referralLevels,
      );

      await expect(svc.requestWithdrawal('aff-1', 40, 'USD')).rejects.toThrow(
        /Insufficient balance. Available: 10.00 USD/,
      );
    });
  });

  describe('settlement commits the flip and the credit together', () => {
    const build = (flipped: Array<{ amount: string }>, dueAffiliates = ['aff-1']) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue(flipped),
        affiliate: { update: jest.fn() },
      };
      const prisma: any = {
        service: { findMany: jest.fn().mockResolvedValue([]) },
        affiliateCommission: {
          groupBy: jest
            .fn()
            .mockResolvedValue(dueAffiliates.map((affiliateId) => ({ affiliateId }))),
        },
        $transaction: jest.fn((fn: any) => fn(tx)),
      };
      const lock = { runWithLock: jest.fn((_k: string, _t: number, fn: any) => fn()) } as any;
      return { prisma, tx, scheduler: new CommissionSettlementScheduler(prisma, lock) };
    };

    it('credits exactly the rows it flipped, inside the same transaction', async () => {
      const { prisma, tx, scheduler } = build([{ amount: '10.0000' }, { amount: '5.5000' }]);

      await scheduler.settleCommissions();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const increment = tx.affiliate.update.mock.calls[0][0].data.totalEarned.increment;
      expect(new Decimal(increment).toFixed(4)).toBe('15.5000');
    });

    it('credits nothing when a concurrent refund voided the commissions first', async () => {
      // The `status = 'pending'` predicate filtered them out, so RETURNING is
      // empty and there is nothing to credit.
      const { tx, scheduler } = build([]);

      await scheduler.settleCommissions();

      expect(tx.affiliate.update).not.toHaveBeenCalled();
    });

    it('keeps settling after one affiliate fails', async () => {
      const { prisma, scheduler } = build([{ amount: '10.0000' }], ['aff-1', 'aff-2']);
      prisma.$transaction
        .mockImplementationOnce(() => Promise.reject(new Error('deadlock detected')))
        .mockImplementationOnce((fn: any) =>
          fn({
            $queryRaw: jest.fn().mockResolvedValue([{ amount: '2.0000' }]),
            affiliate: { update: jest.fn() },
          }),
        );

      await expect(scheduler.settleCommissions()).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('a refund takes back what it credited', () => {
    const build = (settledRows: Array<{ affiliate_id: string; amount: string }>) => {
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue(settledRows),
        order: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'o1',
            userId: 'user-1',
            mode: 'PAYMENT',
            amount: '20.0000',
            currency: 'USD',
          }),
        },
        invoice: { updateMany: jest.fn() },
        affiliate: { update: jest.fn() },
        affiliateCommission: { updateMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
        creditUsage: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        entitlement: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      };
      const service = new PaymentOrchestratorService(
        {} as any,
        { emit: jest.fn().mockResolvedValue(undefined) } as any,
        {} as any,
        { track: jest.fn() } as any,
        { revokeGrant: jest.fn() } as any,
      );
      return { service, tx };
    };

    it('decrements totalEarned by the settled commissions it voided, per affiliate', async () => {
      const { service, tx } = build([
        { affiliate_id: 'aff-1', amount: '3.0000' },
        { affiliate_id: 'aff-1', amount: '1.5000' },
        { affiliate_id: 'aff-2', amount: '0.5000' },
      ]);

      await (service as any).handleOrderRefunded('o1', tx);

      const decrements = tx.affiliate.update.mock.calls.map((c: any[]) => [
        c[0].where.id,
        new Decimal(c[0].data.totalEarned.decrement).toFixed(4),
      ]);
      expect(decrements).toEqual([
        ['aff-1', '4.5000'],
        ['aff-2', '0.5000'],
      ]);
    });

    it('voids unsettled commissions without touching any total', async () => {
      const { service, tx } = build([]);

      await (service as any).handleOrderRefunded('o1', tx);

      expect(tx.affiliateCommission.updateMany).toHaveBeenCalledWith({
        where: { orderId: 'o1', status: 'pending' },
        data: { status: 'voided' },
      });
      expect(tx.affiliate.update).not.toHaveBeenCalled();
    });

    it('says so when the refund arrives after the commission was paid out', async () => {
      const { service, tx } = build([]);
      tx.affiliateCommission.count.mockResolvedValue(2);
      const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      await (service as any).handleOrderRefunded('o1', tx);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('manual clawback'));
    });
  });

  describe('a commission failure is no longer swallowed', () => {
    it('rolls the payment transaction back instead of committing a burnt referral', async () => {
      // `processMultiLevelCommissions` sets the referral's one-shot
      // `firstOrderPaid` flag before writing any commission row. Swallowing the
      // error committed that flag with nothing behind it, and the atomic
      // check-and-set means no later run will ever try again.
      const affiliates = {
        processMultiLevelCommissions: jest.fn().mockRejectedValue(new Error('chain walk failed')),
      };
      const service = new PaymentOrchestratorService(
        {} as any,
        { emit: jest.fn().mockResolvedValue(undefined) } as any,
        affiliates as any,
        { track: jest.fn() } as any,
        { grant: jest.fn() } as any,
      );

      const tx: any = {
        order: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'o1',
            userId: 'user-1',
            mode: 'PAYMENT',
            amount: '20.0000',
            currency: 'USD',
            price: { product: { serviceId: 'svc-1', metadata: {} } },
          }),
        },
        invoice: { create: jest.fn() },
        entitlement: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      };

      await expect((service as any).handleOrderPaid('o1', tx)).rejects.toThrow('chain walk failed');
    });
  });

  describe('the payout announces itself from inside its own transaction', () => {
    it('emits through tx so a rollback takes the event with it', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-20T00:00:00Z'));
      try {
        const tx: any = {
          affiliatePayout: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'payout-1' }),
          },
          affiliateCommission: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ id: 'c1', amount: new Decimal(9), currency: 'USD' }]),
            updateMany: jest.fn(),
          },
          affiliate: { update: jest.fn() },
        };
        const prisma: any = {
          affiliate: {
            findMany: jest.fn().mockResolvedValue([{ id: 'aff-1', serviceId: 'svc-1' }]),
          },
          $transaction: jest.fn((fn: any) => fn(tx)),
        };
        const outbox = { emit: jest.fn().mockResolvedValue(undefined) };

        const processor = new AffiliatePayoutProcessor(prisma, outbox as any);
        await processor.process({} as any);

        expect(outbox.emit).toHaveBeenCalledWith(
          'billing.affiliate.payout.created',
          expect.objectContaining({ payout_id: 'payout-1', amount: '9', currency: 'USD' }),
          expect.objectContaining({ serviceId: 'svc-1', tx }),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
