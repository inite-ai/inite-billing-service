import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/common/services/prisma.service';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { FunnelService } from '../src/funnel/funnel.service';
import { CreditsService } from '../src/credits/credits.service';

/**
 * Tests for the subscription-lifecycle handler that was previously missing.
 * Webhook events for renewal / renewal_failed / cancelled get routed here
 * from WebhookProcessor; before this change they were dropped on the floor.
 */
describe('handleSubscriptionEvent', () => {
  let orchestrator: PaymentOrchestratorService;
  let prisma: any;
  let outbox: any;

  const mockSub = (overrides: Partial<any> = {}) => ({
    id: 'sub-1',
    userId: 'user-1',
    priceId: 'price-1',
    status: 'active',
    rail: 'STRIPE',
    providerSubscriptionId: 'sub_stripe_xyz',
    currentPeriodStart: new Date('2026-04-23T00:00:00Z'),
    currentPeriodEnd: new Date('2026-05-23T00:00:00Z'),
    cancelAtPeriodEnd: false,
    price: {
      id: 'price-1',
      amount: 29,
      currency: 'USD',
      interval: 'month',
      graceDays: 3,
      product: {
        id: 'prod-1',
        code: 'inite-visibility-starter',
        metadata: { entitlements: ['visibility.starter'] },
      },
    },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      subscription: {
        findFirst: jest.fn(),
        // Also answers the owner lookup: outbox events are addressed to the
        // service that sold the plan.
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub-1',
          price: { product: { serviceId: 'svc-1' } },
        }),
        update: jest.fn(),
        create: jest.fn(),
      },
      order: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'renewal-order-1', ...data }),
          ),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      paymentIntent: {
        create: jest.fn().mockResolvedValue({ id: 'renewal-pi-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      invoice: { create: jest.fn(), updateMany: jest.fn() },
      entitlement: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };
    outbox = { emit: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentOrchestratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: OutboxService, useValue: outbox },
        { provide: AffiliatesService, useValue: { processMultiLevelCommissions: jest.fn() } },
        { provide: FunnelService, useValue: { track: jest.fn() } },
        {
          provide: CreditsService,
          useValue: { grant: jest.fn(), resetForPeriod: jest.fn(), revokeGrant: jest.fn() },
        },
      ],
    }).compile();

    orchestrator = module.get<PaymentOrchestratorService>(PaymentOrchestratorService);
  });

  describe('subscription.renewed', () => {
    it('creates a paid Order + PaymentIntent and runs the existing fulfilment path', async () => {
      const sub = mockSub();
      prisma.subscription.findFirst.mockResolvedValue(sub);
      // handleOrderPaid → findUnique on the synth order
      prisma.order.findUnique.mockResolvedValue({
        id: 'renewal-order-1',
        userId: sub.userId,
        priceId: sub.priceId,
        amount: 29,
        currency: 'USD',
        mode: 'SUBSCRIPTION',
        status: 'paid',
        price: sub.price,
      });
      // handleSubscriptionPayment finds the existing sub to update
      prisma.subscription.findFirst.mockImplementation(({ where }: any) => {
        if (where?.rail) return Promise.resolve(sub);
        // call from handleSubscriptionPayment
        return Promise.resolve(sub);
      });
      prisma.subscription.findUnique.mockResolvedValue(sub);

      await orchestrator.handleSubscriptionEvent(
        'STRIPE',
        'subscription.renewed',
        'sub_stripe_xyz',
        { id: 'ch_renewal_42', amount: 2900, currency: 'usd' },
      );

      // New Order created
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            priceId: 'price-1',
            status: 'paid',
            mode: 'SUBSCRIPTION',
            metadata: expect.objectContaining({ renewal: true, subscription_id: 'sub-1' }),
          }),
        }),
      );
      // New PaymentIntent records the renewal charge ID
      expect(prisma.paymentIntent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rail: 'STRIPE',
            status: 'paid',
            providerIntentId: 'ch_renewal_42',
          }),
        }),
      );
      // Invoice created (via handleOrderPaid)
      expect(prisma.invoice.create).toHaveBeenCalled();
      // Sub period advanced
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            status: 'active',
            currentPeriodStart: expect.any(Date),
            currentPeriodEnd: expect.any(Date),
          }),
        }),
      );
    });

    it('logs warn and no-ops when the sub is unknown', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      await orchestrator.handleSubscriptionEvent(
        'STRIPE',
        'subscription.renewed',
        'sub_unknown',
        {},
      );
      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('is idempotent — a reprocessed renewal with an existing charge intent is skipped', async () => {
      const sub = mockSub();
      prisma.subscription.findFirst.mockResolvedValue(sub);
      // A PaymentIntent already exists for (rail, renewal charge id): this
      // renewal was already applied (duplicate delivery / crash-recovery re-run).
      prisma.paymentIntent.findFirst.mockResolvedValue({ id: 'existing-renewal-pi' });

      await orchestrator.handleSubscriptionEvent(
        'STRIPE',
        'subscription.renewed',
        'sub_stripe_xyz',
        {
          id: 'ch_renewal_42',
        },
      );

      // No second Order / PaymentIntent, no double period-advance / regrant.
      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(prisma.paymentIntent.create).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('uses a deterministic charge id (no Date.now) when the provider sends none', async () => {
      const sub = mockSub();
      prisma.subscription.findFirst.mockResolvedValue(sub);
      prisma.order.findUnique.mockResolvedValue({
        id: 'renewal-order-1',
        userId: sub.userId,
        priceId: sub.priceId,
        amount: 29,
        currency: 'USD',
        mode: 'SUBSCRIPTION',
        status: 'paid',
        price: sub.price,
      });
      prisma.subscription.findUnique.mockResolvedValue(sub);

      // No id/charge/payment_intent in providerData → deterministic fallback.
      await orchestrator.handleSubscriptionEvent(
        'STRIPE',
        'subscription.renewed',
        'sub_stripe_xyz',
        {},
      );

      const providerIntentId = prisma.paymentIntent.create.mock.calls[0][0].data.providerIntentId;
      expect(providerIntentId).toBe(`renewal_sub-1_${sub.currentPeriodEnd.toISOString()}`);
      // The guard checked (rail, that same deterministic id) first.
      expect(prisma.paymentIntent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { rail: 'STRIPE', providerIntentId },
        }),
      );
    });
  });

  describe('subscription.renewal_failed', () => {
    it('flips status to past_due and emits payment_failed outbox event', async () => {
      const sub = mockSub({ status: 'active' });
      prisma.subscription.findFirst.mockResolvedValue(sub);

      await orchestrator.handleSubscriptionEvent(
        'LAVA',
        'subscription.renewal_failed',
        'lava-contract-123',
        { errorMessage: 'card_declined' },
      );

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'past_due' }),
      });
      expect(outbox.emit).toHaveBeenCalledWith(
        'billing.subscription.payment_failed',
        expect.objectContaining({
          subscription_id: 'sub-1',
          provider_error: 'card_declined',
        }),
        expect.objectContaining({ tx: prisma }),
      );
    });

    it('idempotent — already past_due does not re-update', async () => {
      const sub = mockSub({ status: 'past_due' });
      prisma.subscription.findFirst.mockResolvedValue(sub);

      await orchestrator.handleSubscriptionEvent(
        'LAVA',
        'subscription.renewal_failed',
        'lava-contract-123',
        {},
      );

      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('store lifecycle events beyond the original three', () => {
    // These used to fall through to the payment-intent lookup, which matches on
    // a charge id while the event carries a subscription id: nothing matched,
    // the event was marked failed, retried, and abandoned. An Apple or Google
    // subscription that expired or went on hold therefore never ended here, and
    // the customer kept entitlements the store had stopped billing for.

    it('subscription.expired ends the subscription and revokes its access', async () => {
      const sub = mockSub();
      prisma.subscription.findFirst.mockResolvedValue(sub);
      prisma.subscription.findUnique.mockResolvedValue(sub);
      prisma.entitlement.findMany.mockResolvedValue([]);

      await orchestrator.handleSubscriptionEvent(
        'APPLE_IAP',
        'subscription.expired',
        'apple-original-tx-1',
        {},
      );

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'ended' }),
      });
    });

    it.each(['subscription.on_hold', 'subscription.grace_period'])(
      '%s puts the subscription in past_due, which is what the store means',
      async (eventType) => {
        const sub = mockSub();
        prisma.subscription.findFirst.mockResolvedValue(sub);

        await orchestrator.handleSubscriptionEvent(
          'GOOGLE_PLAY',
          eventType as any,
          'google-purchase-token-1',
          {},
        );

        expect(prisma.subscription.update).toHaveBeenCalledWith({
          where: { id: 'sub-1' },
          data: expect.objectContaining({ status: 'past_due' }),
        });
      },
    );

    it.each(['subscription.recovered', 'subscription.restarted'])(
      '%s advances the period, because the store is charging again',
      async (eventType) => {
        const sub = mockSub();
        prisma.subscription.findFirst.mockResolvedValue(sub);
        prisma.paymentIntent.findFirst.mockResolvedValue(null);
        prisma.order.create.mockResolvedValue({ id: 'renewal-order-1' });
        prisma.paymentIntent.create.mockResolvedValue({ id: 'renewal-intent-1' });
        prisma.order.findUnique.mockResolvedValue(null);

        await orchestrator.handleSubscriptionEvent(
          'GOOGLE_PLAY',
          eventType as any,
          'google-purchase-token-1',
          {},
        );

        expect(prisma.order.create).toHaveBeenCalled();
      },
    );

    it.each(['subscription.created', 'subscription.updated'])(
      '%s is acknowledged without touching the subscription',
      async (eventType) => {
        const sub = mockSub();
        prisma.subscription.findFirst.mockResolvedValue(sub);

        await orchestrator.handleSubscriptionEvent(
          'STRIPE',
          eventType as any,
          'sub_stripe_xyz',
          {},
        );

        // No action — but handled here rather than retried down the payment
        // path until the event was given up on.
        expect(prisma.subscription.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('subscription.cancelled', () => {
    it('with period still in future: only flips cancelAtPeriodEnd, keeps access', async () => {
      const sub = mockSub({
        currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      prisma.subscription.findFirst.mockResolvedValue(sub);

      await orchestrator.handleSubscriptionEvent(
        'STRIPE',
        'subscription.cancelled',
        'sub_stripe_xyz',
        {},
      );

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ cancelAtPeriodEnd: true }),
      });
      // Entitlements NOT revoked yet — user keeps access until period end
      expect(prisma.entitlement.updateMany).not.toHaveBeenCalled();
    });

    it('with period already passed: cancels immediately and revokes entitlements', async () => {
      const sub = mockSub({
        currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      prisma.subscription.findFirst.mockResolvedValue(sub);
      prisma.entitlement.findMany.mockResolvedValue([
        {
          id: 'ent-1',
          userId: 'user-1',
          key: 'visibility.starter',
          value: { subscription_id: 'sub-1' },
        },
      ]);

      await orchestrator.handleSubscriptionEvent(
        'STRIPE',
        'subscription.cancelled',
        'sub_stripe_xyz',
        {},
      );

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'canceled', cancelAtPeriodEnd: true }),
      });
      expect(prisma.entitlement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['ent-1'] } },
          data: expect.objectContaining({ status: 'revoked' }),
        }),
      );
    });
  });
});

describe('revokeSubscriptionEntitlements', () => {
  let orchestrator: PaymentOrchestratorService;
  let prisma: any;
  let outbox: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      entitlement: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      // The revoked events are addressed to the service that sold the plan.
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub-target',
          price: { product: { serviceId: 'svc-1' } },
        }),
      },
    };
    outbox = { emit: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentOrchestratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: OutboxService, useValue: outbox },
        { provide: AffiliatesService, useValue: { processMultiLevelCommissions: jest.fn() } },
        { provide: FunnelService, useValue: { track: jest.fn() } },
        {
          provide: CreditsService,
          useValue: { grant: jest.fn(), resetForPeriod: jest.fn(), revokeGrant: jest.fn() },
        },
      ],
    }).compile();
    orchestrator = module.get(PaymentOrchestratorService);
  });

  it('revokes only entitlements whose value.subscription_id matches', async () => {
    prisma.entitlement.findMany.mockResolvedValue([
      { id: 'a', userId: 'u1', key: 'x', value: { subscription_id: 'sub-target' } },
      { id: 'b', userId: 'u1', key: 'y', value: { subscription_id: 'sub-other' } },
      { id: 'c', userId: 'u1', key: 'z', value: { subscription_id: 'sub-target' } },
    ]);

    await orchestrator.revokeSubscriptionEntitlements('sub-target', prisma);

    expect(prisma.entitlement.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'c'] } },
      data: expect.objectContaining({ status: 'revoked' }),
    });
    expect(outbox.emit).toHaveBeenCalledTimes(2);
  });

  it('no-op when nothing matches', async () => {
    prisma.entitlement.findMany.mockResolvedValue([
      { id: 'b', userId: 'u1', key: 'y', value: { subscription_id: 'sub-other' } },
    ]);

    await orchestrator.revokeSubscriptionEntitlements('sub-target', prisma);

    expect(prisma.entitlement.updateMany).not.toHaveBeenCalled();
    expect(outbox.emit).not.toHaveBeenCalled();
  });
});
