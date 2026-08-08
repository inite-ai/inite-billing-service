import { SubscriptionExpirerScheduler } from '../src/workers/subscription-expirer.scheduler';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { PrismaService } from '../src/common/services/prisma.service';

/**
 * Closes the loop on expired subscriptions across the four cases the
 * webhook layer can't handle on its own.
 */
describe('SubscriptionExpirerScheduler', () => {
  let scheduler: SubscriptionExpirerScheduler;
  let prisma: any;
  let orchestrator: any;

  const oneHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);
  const tenDaysAgo = () => new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    prisma = {
      subscription: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    orchestrator = {
      endSubscription: jest.fn(),
    };
    scheduler = new SubscriptionExpirerScheduler(
      prisma as PrismaService,
      orchestrator as PaymentOrchestratorService,
      // Lock stub: run the body directly (no coordination in unit tests).
      { runWithLock: (_k: string, _t: number, fn: () => Promise<void>) => fn() } as any,
    );
  });

  it('ends PROMO/no-provider subs whose period has passed (promo_expired)', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-promo',
        status: 'active',
        providerSubscriptionId: null,
        rail: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: oneHourAgo(),
        price: { graceDays: 0 },
      },
    ]);

    await scheduler.sweep();

    expect(orchestrator.endSubscription).toHaveBeenCalledWith('sub-promo', 'promo_expired');
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('cancels subs marked cancelAtPeriodEnd when period passes', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-cancelling',
        status: 'active',
        providerSubscriptionId: 'sub_stripe_xyz',
        rail: 'STRIPE',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: oneHourAgo(),
        price: { graceDays: 3 },
      },
    ]);

    await scheduler.sweep();

    expect(orchestrator.endSubscription).toHaveBeenCalledWith(
      'sub-cancelling',
      'cancelled_at_period_end',
    );
  });

  it('flips provider-backed sub to past_due when renewal webhook is overdue', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-overdue',
        status: 'active',
        providerSubscriptionId: 'sub_stripe_xyz',
        rail: 'STRIPE',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: oneHourAgo(),
        price: { graceDays: 3 },
      },
    ]);

    await scheduler.sweep();

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-overdue' },
      data: expect.objectContaining({ status: 'past_due' }),
    });
    expect(orchestrator.endSubscription).not.toHaveBeenCalled();
  });

  it('ends past_due subs once the grace window has elapsed', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-grace-exhausted',
        status: 'past_due',
        providerSubscriptionId: 'sub_stripe_xyz',
        rail: 'STRIPE',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: tenDaysAgo(),
        price: { graceDays: 3 },
      },
    ]);

    await scheduler.sweep();

    expect(orchestrator.endSubscription).toHaveBeenCalledWith(
      'sub-grace-exhausted',
      'grace_period_exhausted',
    );
  });

  it('leaves past_due subs alone while still inside grace window', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-in-grace',
        status: 'past_due',
        providerSubscriptionId: 'sub_stripe_xyz',
        rail: 'STRIPE',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: oneHourAgo(),
        price: { graceDays: 3 },
      },
    ]);

    await scheduler.sweep();

    expect(orchestrator.endSubscription).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('does nothing when nothing is expired', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    await scheduler.sweep();
    expect(orchestrator.endSubscription).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('isolates failures: one bad sub does not block the rest', async () => {
    orchestrator.endSubscription
      .mockRejectedValueOnce(new Error('db blew up'))
      .mockResolvedValueOnce(undefined);

    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-fail',
        status: 'active',
        providerSubscriptionId: null,
        currentPeriodEnd: oneHourAgo(),
        cancelAtPeriodEnd: false,
        price: { graceDays: 0 },
      },
      {
        id: 'sub-ok',
        status: 'active',
        providerSubscriptionId: null,
        currentPeriodEnd: oneHourAgo(),
        cancelAtPeriodEnd: false,
        price: { graceDays: 0 },
      },
    ]);

    await scheduler.sweep();

    expect(orchestrator.endSubscription).toHaveBeenCalledTimes(2);
    expect(orchestrator.endSubscription).toHaveBeenNthCalledWith(2, 'sub-ok', 'promo_expired');
  });
});
