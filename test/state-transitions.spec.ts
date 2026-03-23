import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/common/services/prisma.service';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { FunnelService } from '../src/funnel/funnel.service';
import { CreditsService } from '../src/credits/credits.service';

describe('State Transitions', () => {
  let orchestrator: PaymentOrchestratorService;
  let prisma: PrismaService;
  let outbox: OutboxService;

  beforeEach(async () => {
    const mockPrisma: any = {
      $transaction: jest.fn((callback: any) => callback(mockPrisma)),
      paymentIntent: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      order: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      invoice: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      entitlement: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockOutbox = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentOrchestratorService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: OutboxService,
          useValue: mockOutbox,
        },
        {
          provide: AffiliatesService,
          useValue: { processMultiLevelCommissions: jest.fn() },
        },
        {
          provide: FunnelService,
          useValue: { track: jest.fn() },
        },
        {
          provide: CreditsService,
          useValue: { grant: jest.fn(), resetForPeriod: jest.fn(), refund: jest.fn() },
        },
      ],
    }).compile();

    orchestrator = module.get<PaymentOrchestratorService>(PaymentOrchestratorService);
    prisma = module.get<PrismaService>(PrismaService);
    outbox = module.get<OutboxService>(OutboxService);
  });

  it('should apply state transition from opened to paid', async () => {
    const mockIntent = {
      id: 'intent-id',
      orderId: 'order-id',
      status: 'opened',
      snapshot: {},
      order: {
        id: 'order-id',
        userId: 'user-id',
        status: 'open',
        priceId: 'price-id',
        mode: 'PAYMENT',
        amount: 100,
        currency: 'USD',
        price: {
          id: 'price-id',
          product: {
            id: 'product-id',
            code: 'test-product',
            metadata: { entitlements: ['test.entitlement'] },
          },
        },
      },
    };

    (prisma.paymentIntent.findUnique as jest.Mock).mockResolvedValue(mockIntent);
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockIntent.order);

    await orchestrator.applyStateTransition('intent-id', 'paid', { status: 'paid' });

    expect(prisma.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent-id' },
      data: {
        status: 'paid',
        snapshot: { status: 'paid' },
        updatedAt: expect.any(Date),
      },
    });

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-id' },
      data: {
        status: 'paid',
        updatedAt: expect.any(Date),
      },
    });
  });

  it('should be idempotent - skip if already in target state', async () => {
    const mockIntent = {
      id: 'intent-id',
      orderId: 'order-id',
      status: 'paid', // Already paid
      snapshot: {},
      order: {
        id: 'order-id',
        status: 'paid',
      },
    };

    (prisma.paymentIntent.findUnique as jest.Mock).mockResolvedValue(mockIntent);

    await orchestrator.applyStateTransition('intent-id', 'paid');

    // Should not update if already in target state
    expect(prisma.paymentIntent.update).not.toHaveBeenCalled();
  });
});

