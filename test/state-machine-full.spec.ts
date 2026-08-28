import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/common/services/prisma.service';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { FunnelService } from '../src/funnel/funnel.service';
import { CreditsService } from '../src/credits/credits.service';
import {
  isValidTransition,
  VALID_INTENT_TRANSITIONS,
  IntentStatus,
} from '../src/common/types/payment-state.types';

describe('State Machine — exhaustive transitions', () => {
  const ALL_STATUSES: IntentStatus[] = [
    'created',
    'opened',
    'paid',
    'failed',
    'expired',
    'refunded',
  ];

  it('every valid transition is in the map', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const valid = isValidTransition(from, to);
        const expected = VALID_INTENT_TRANSITIONS[from].includes(to);
        expect(valid).toBe(expected);
      }
    }
  });

  it('terminal states have no outgoing transitions', () => {
    expect(VALID_INTENT_TRANSITIONS.failed).toEqual([]);
    expect(VALID_INTENT_TRANSITIONS.expired).toEqual([]);
    expect(VALID_INTENT_TRANSITIONS.refunded).toEqual([]);
  });

  it('paid can only go to refunded', () => {
    expect(VALID_INTENT_TRANSITIONS.paid).toEqual(['refunded']);
  });

  it('cannot go backward: paid → opened', () => {
    expect(isValidTransition('paid', 'opened')).toBe(false);
  });

  it('cannot go backward: refunded → paid', () => {
    expect(isValidTransition('refunded', 'paid')).toBe(false);
  });

  it('cannot go backward: failed → created', () => {
    expect(isValidTransition('failed', 'created')).toBe(false);
  });

  it('self-transition is invalid for all states', () => {
    for (const status of ALL_STATUSES) {
      expect(isValidTransition(status, status)).toBe(false);
    }
  });
});

describe('State Machine — orchestrator side effects', () => {
  let orchestrator: PaymentOrchestratorService;
  let mockPrisma: any;
  let mockOutbox: any;
  let mockAffiliates: any;
  let mockCredits: any;
  let mockFunnel: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn((cb: any) => cb(mockPrisma)),
      // The transition row-locks the intent before reading it.
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentIntent: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      order: { findUnique: jest.fn(), update: jest.fn() },
      invoice: { create: jest.fn(), updateMany: jest.fn() },
      entitlement: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      subscription: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      affiliateCommission: { updateMany: jest.fn() },
      creditUsage: { findMany: jest.fn().mockResolvedValue([]) },
    };
    mockOutbox = { emit: jest.fn().mockResolvedValue(undefined) };
    mockAffiliates = { processMultiLevelCommissions: jest.fn() };
    mockCredits = { grant: jest.fn(), resetForPeriod: jest.fn(), refund: jest.fn() };
    mockFunnel = { track: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentOrchestratorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OutboxService, useValue: mockOutbox },
        { provide: AffiliatesService, useValue: mockAffiliates },
        { provide: FunnelService, useValue: mockFunnel },
        { provide: CreditsService, useValue: mockCredits },
      ],
    }).compile();

    orchestrator = module.get(PaymentOrchestratorService);
  });

  const makeIntent = (status: string, mode = 'PAYMENT') => ({
    id: 'intent-1',
    orderId: 'order-1',
    status,
    snapshot: {},
    order: {
      id: 'order-1',
      userId: 'user-1',
      status: status === 'opened' ? 'open' : status,
      priceId: 'price-1',
      mode,
      amount: 100,
      currency: 'USD',
      price: {
        id: 'price-1',
        interval: 'month',
        trialDays: 0,
        graceDays: 0,
        product: {
          id: 'prod-1',
          code: 'test-product',
          serviceId: 'svc-1',
          metadata: { entitlements: ['access.pro'] },
        },
      },
    },
  });

  it('opened → paid creates invoice', async () => {
    const intent = makeIntent('opened');
    mockPrisma.paymentIntent.findUnique.mockResolvedValue(intent);
    mockPrisma.order.findUnique.mockResolvedValue(intent.order);

    await orchestrator.applyStateTransition('intent-1', 'paid', {});

    expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-1',
          status: 'paid',
          amount: 100,
          currency: 'USD',
        }),
      }),
    );
  });

  it('opened → paid grants entitlements for PAYMENT mode', async () => {
    const intent = makeIntent('opened', 'PAYMENT');
    mockPrisma.paymentIntent.findUnique.mockResolvedValue(intent);
    mockPrisma.order.findUnique.mockResolvedValue(intent.order);

    await orchestrator.applyStateTransition('intent-1', 'paid', {});

    expect(mockPrisma.entitlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          key: 'access.pro',
          status: 'active',
          source: 'order',
        }),
      }),
    );
  });

  it('opened → paid creates subscription for SUBSCRIPTION mode', async () => {
    const intent = makeIntent('opened', 'SUBSCRIPTION');
    mockPrisma.paymentIntent.findUnique.mockResolvedValue(intent);
    mockPrisma.order.findUnique.mockResolvedValue(intent.order);
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    mockPrisma.subscription.create.mockResolvedValue({ id: 'sub-1', status: 'active' });

    await orchestrator.applyStateTransition('intent-1', 'paid', {});

    expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          priceId: 'price-1',
          status: 'active',
        }),
      }),
    );
  });

  it('opened → paid triggers affiliate commissions', async () => {
    const intent = makeIntent('opened');
    mockPrisma.paymentIntent.findUnique.mockResolvedValue(intent);
    mockPrisma.order.findUnique.mockResolvedValue(intent.order);

    await orchestrator.applyStateTransition('intent-1', 'paid', {});

    expect(mockAffiliates.processMultiLevelCommissions).toHaveBeenCalledWith(
      'order-1',
      'user-1',
      100,
      'USD',
      'svc-1',
      expect.anything(),
    );
  });

  it('opened → paid emits outbox events', async () => {
    const intent = makeIntent('opened');
    mockPrisma.paymentIntent.findUnique.mockResolvedValue(intent);
    mockPrisma.order.findUnique.mockResolvedValue(intent.order);

    await orchestrator.applyStateTransition('intent-1', 'paid', {});

    expect(mockOutbox.emit).toHaveBeenCalledWith(
      'billing.payment.status_changed',
      expect.objectContaining({ status: 'paid' }),
      undefined,
      expect.anything(),
    );
    expect(mockOutbox.emit).toHaveBeenCalledWith(
      'billing.payment.succeeded',
      expect.objectContaining({ order_id: 'order-1' }),
      undefined,
      expect.anything(),
    );
  });

  it('opened → paid tracks funnel event', async () => {
    const intent = makeIntent('opened');
    mockPrisma.paymentIntent.findUnique.mockResolvedValue(intent);
    mockPrisma.order.findUnique.mockResolvedValue(intent.order);

    await orchestrator.applyStateTransition('intent-1', 'paid', {});

    expect(mockFunnel.track).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'payment_completed',
        stage: 'conversion',
      }),
    );
  });

  it('paid → refunded voids commissions and revokes entitlements', async () => {
    const intent = makeIntent('paid');
    intent.order.status = 'paid';
    mockPrisma.paymentIntent.findUnique.mockResolvedValue(intent);
    mockPrisma.order.findUnique.mockResolvedValue(intent.order);
    mockPrisma.entitlement.findMany.mockResolvedValue([
      { id: 'ent-1', value: { order_id: 'order-1' } },
      { id: 'ent-2', value: { order_id: 'other-order' } }, // should NOT be revoked
    ]);

    await orchestrator.applyStateTransition('intent-1', 'refunded', {});

    // Voids commissions
    expect(mockPrisma.affiliateCommission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderId: 'order-1',
          status: { in: ['pending', 'earned'] },
        }),
        data: { status: 'voided' },
      }),
    );

    // Revokes only entitlements for THIS order
    expect(mockPrisma.entitlement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['ent-1'] } }, // ent-2 excluded
        data: expect.objectContaining({ status: 'revoked' }),
      }),
    );
  });

  it('rejects invalid transition (failed → paid)', async () => {
    const intent = makeIntent('failed');
    mockPrisma.paymentIntent.findUnique.mockResolvedValue(intent);

    // Should throw or silently skip
    await expect(orchestrator.applyStateTransition('intent-1', 'paid', {})).rejects.toThrow();
  });

  it('throws for non-existent intent', async () => {
    mockPrisma.paymentIntent.findUnique.mockResolvedValue(null);

    await expect(orchestrator.applyStateTransition('nonexistent', 'paid', {})).rejects.toThrow();
  });
});
