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
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      order: {
        create: jest.fn().mockImplementation(({ data }: any) =>
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
        { provide: CreditsService, useValue: { grant: jest.fn(), resetForPeriod: jest.fn(), refund: jest.fn() } },
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
        undefined,
        prisma,
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
        { id: 'ent-1', userId: 'user-1', key: 'visibility.starter', value: { subscription_id: 'sub-1' } },
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
    };
    outbox = { emit: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentOrchestratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: OutboxService, useValue: outbox },
        { provide: AffiliatesService, useValue: { processMultiLevelCommissions: jest.fn() } },
        { provide: FunnelService, useValue: { track: jest.fn() } },
        { provide: CreditsService, useValue: { grant: jest.fn(), resetForPeriod: jest.fn(), refund: jest.fn() } },
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
