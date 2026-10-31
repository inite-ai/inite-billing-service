import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/common/services/prisma.service';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { FunnelService } from '../src/funnel/funnel.service';
import { CreditsService } from '../src/credits/credits.service';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { SubscriptionExpirerScheduler } from '../src/workers/subscription-expirer.scheduler';

/**
 * What a selling service hears about its subscribers: `created` on a plan's
 * first payment (not on each renewal), `cancel_scheduled` and `resumed` when
 * the person acts on billing's page, and a renewal billing opened is fulfilled
 * as a renewal, never as a one-time purchase.
 */
describe('family subscription events', () => {
  let orchestrator: PaymentOrchestratorService;
  let prisma: any;
  let outbox: any;
  let credits: any;

  const product = {
    id: 'prod-1',
    code: 'studio-pro',
    serviceId: 'svc-1',
    metadata: { entitlements: ['studio:plan:pro'], creditsPerPeriod: 100 },
  };
  const price = {
    id: 'price-1',
    code: 'studio-pro-monthly',
    amount: 39,
    currency: 'USD',
    interval: 'month',
    graceDays: 3,
    trialDays: 0,
    product,
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      order: { findUnique: jest.fn() },
      invoice: { create: jest.fn() },
      paymentIntent: { findFirst: jest.fn().mockResolvedValue({ rail: 'HODLE', snapshot: {} }) },
      subscription: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'sub-new', ...data })),
        update: jest.fn(),
      },
      entitlement: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };
    outbox = { emit: jest.fn() };
    credits = { grant: jest.fn(), resetForPeriod: jest.fn(), revokeGrant: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentOrchestratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: OutboxService, useValue: outbox },
        { provide: AffiliatesService, useValue: { processMultiLevelCommissions: jest.fn() } },
        { provide: FunnelService, useValue: { track: jest.fn() } },
        { provide: CreditsService, useValue: credits },
      ],
    }).compile();
    orchestrator = module.get(PaymentOrchestratorService);
  });

  const types = () => outbox.emit.mock.calls.map((c: any[]) => c[0]);

  it('emits created on the first payment of a plan', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o-1',
      userId: 'did:key:z6Mkbuyer',
      priceId: 'price-1',
      mode: 'SUBSCRIPTION',
      amount: 39,
      currency: 'USD',
      price,
    });
    prisma.subscription.findFirst.mockResolvedValue(null);
    await (orchestrator as any).handleOrderPaid('o-1', prisma);
    expect(types()).toEqual(
      expect.arrayContaining(['billing.subscription.created', 'billing.subscription.updated']),
    );
    expect(outbox.emit).toHaveBeenCalledWith(
      'billing.subscription.created',
      expect.objectContaining({ subscription_id: 'sub-new', price_code: 'studio-pro-monthly' }),
      expect.objectContaining({ serviceId: 'svc-1' }),
    );
  });

  it('does not emit created on a provider renewal', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o-2',
      userId: 'did:key:z6Mkbuyer',
      priceId: 'price-1',
      mode: 'SUBSCRIPTION',
      amount: 39,
      currency: 'USD',
      price,
    });
    const live = { id: 'sub-1', status: 'active', rail: 'LAVA', providerSubscriptionId: 'c-1' };
    prisma.subscription.findFirst.mockResolvedValue(live);
    prisma.subscription.findUnique.mockResolvedValue(live);
    await (orchestrator as any).handleOrderPaid('o-2', prisma);
    expect(types()).not.toContain('billing.subscription.created');
    expect(types()).toContain('billing.subscription.updated');
  });

  it('fulfils a billing renewal as a renewal, not a one-time purchase', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o-3',
      userId: 'did:key:z6Mkbuyer',
      priceId: 'price-1',
      mode: 'PAYMENT',
      amount: 39,
      currency: 'USD',
      price,
      metadata: {
        subscriptionRenewal: { subscriptionId: 'sub-1', periodEnd: '2099-01-01T00:00:00.000Z' },
      },
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      userId: 'did:key:z6Mkbuyer',
      priceId: 'price-1',
      status: 'active',
      rail: 'HODLE',
      currentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
    });
    prisma.subscription.findFirst.mockResolvedValue({
      currentPeriodEnd: new Date('2099-02-01T00:00:00Z'),
    });
    await (orchestrator as any).handleOrderPaid('o-3', prisma);

    // Granted as the subscription's, not as the order's.
    for (const call of prisma.entitlement.create.mock.calls) {
      expect(call[0].data.source).toBe('subscription');
    }
    expect(credits.resetForPeriod).toHaveBeenCalled();
    expect(credits.grant).not.toHaveBeenCalled();
    expect(types()).not.toContain('billing.subscription.created');
    expect(outbox.emit).toHaveBeenCalledWith(
      'billing.subscription.updated',
      expect.objectContaining({ renewal: true, order_id: 'o-3' }),
      expect.anything(),
    );
  });

  it('moves a no-card trial to another plan without payment', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      userId: 'did:key:z6Mkbuyer',
      priceId: 'price-0',
      status: 'trialing',
      currentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
    });
    await expect(orchestrator.changePlanWithoutPayment('sub-1', price)).resolves.toBe(true);
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priceId: 'price-1' }) }),
    );
  });

  describe('cancel and resume on billing’s page', () => {
    let subscriptions: SubscriptionsService;
    const row = (cancelAtPeriodEnd: boolean) => ({
      id: 'sub-1',
      userId: 'did:key:z6Mkbuyer',
      cancelAtPeriodEnd,
      currentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
      price: { product: { serviceId: 'svc-1' } },
    });

    beforeEach(() => {
      subscriptions = new SubscriptionsService(
        prisma,
        outbox,
        credits,
        { track: jest.fn() } as any,
        { cancelProviderSubscription: jest.fn() } as any,
      );
    });

    it('tells the service a cancel was scheduled, once', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce(row(false));
      await subscriptions.cancelSubscription('did:key:z6Mkbuyer', 'sub-1');
      expect(outbox.emit).toHaveBeenCalledWith(
        'billing.subscription.cancel_scheduled',
        expect.objectContaining({ subscription_id: 'sub-1' }),
        expect.objectContaining({ serviceId: 'svc-1' }),
      );
      outbox.emit.mockClear();
      prisma.subscription.findFirst.mockResolvedValueOnce(row(true));
      await subscriptions.cancelSubscription('did:key:z6Mkbuyer', 'sub-1');
      expect(outbox.emit).not.toHaveBeenCalled();
    });

    it('tells the service a plan was resumed, only when it was cancelled', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce(row(true));
      await subscriptions.resumeSubscription('did:key:z6Mkbuyer', 'sub-1');
      expect(outbox.emit).toHaveBeenCalledWith(
        'billing.subscription.resumed',
        expect.objectContaining({ subscription_id: 'sub-1' }),
        expect.objectContaining({ serviceId: 'svc-1' }),
      );
      outbox.emit.mockClear();
      prisma.subscription.findFirst.mockResolvedValueOnce(row(false));
      await subscriptions.resumeSubscription('did:key:z6Mkbuyer', 'sub-1');
      expect(outbox.emit).not.toHaveBeenCalled();
    });
  });

  describe('expiry of a plan billing renews', () => {
    const env = process.env.SUBSCRIPTION_RENEWALS_ENABLED;
    afterEach(() => {
      process.env.SUBSCRIPTION_RENEWALS_ENABLED = env;
    });
    const pix = {
      id: 'sub-pix',
      userId: 'did:key:z6Mkbuyer',
      status: 'active',
      providerSubscriptionId: null,
      rail: 'HODLE',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(Date.now() - 3_600_000),
      price: { graceDays: 3, product: { serviceId: 'svc-1' } },
    };
    const scheduler = (endSubscription: jest.Mock) =>
      new SubscriptionExpirerScheduler(
        {
          subscription: {
            findMany: jest.fn().mockResolvedValue([pix]),
            update: prisma.subscription.update,
          },
        } as any,
        { endSubscription } as any,
        { runWithLock: (_k: string, _t: number, fn: () => Promise<void>) => fn() } as any,
        outbox,
      );

    it('goes past_due into the grace window while the link is unpaid', async () => {
      process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'true';
      const end = jest.fn();
      await scheduler(end).sweep();
      expect(end).not.toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'past_due' }) }),
      );
      expect(outbox.emit).toHaveBeenCalledWith(
        'billing.subscription.payment_failed',
        expect.objectContaining({ provider_error: 'renewal_unpaid' }),
        { serviceId: 'svc-1' },
      );
    });

    it('ends with its period, as before, while renewals are off', async () => {
      process.env.SUBSCRIPTION_RENEWALS_ENABLED = 'false';
      const end = jest.fn();
      await scheduler(end).sweep();
      expect(end).toHaveBeenCalledWith('sub-pix', 'promo_expired');
    });
  });
});
