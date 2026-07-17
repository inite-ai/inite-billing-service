import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/common/services/prisma.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('Webhook Idempotency', () => {
  let service: WebhooksService;
  let prisma: PrismaService;
  let mockQueue: any;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: PrismaService,
          useValue: {
            webhookEvent: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: getQueueToken('webhooks'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should store webhook event idempotently', async () => {
    const mockCreate = prisma.webhookEvent.create as jest.Mock;
    mockCreate.mockResolvedValueOnce({
      id: 'event-id',
      rail: 'ONE',
      webhookId: 'webhook-123',
    });

    await service.storeWebhookEvent('ONE', 'webhook-123', 'payment.order.updated', 'order-id', {
      status: 'paid',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        rail: 'ONE',
        webhookId: 'webhook-123',
        eventType: 'payment.order.updated',
        entityId: 'order-id',
        payload: { status: 'paid' },
        status: 'received',
      },
    });
  });

  it('should handle duplicate webhook gracefully (idempotency)', async () => {
    const mockCreate = prisma.webhookEvent.create as jest.Mock;
    const duplicateError = new Error('Unique constraint violation');
    (duplicateError as any).code = 'P2002';
    mockCreate.mockRejectedValueOnce(duplicateError);

    // Should not throw - idempotent behavior
    await expect(
      service.storeWebhookEvent('ONE', 'webhook-123', 'payment.order.updated', 'order-id', {
        status: 'paid',
      }),
    ).resolves.not.toThrow();
  });
});
