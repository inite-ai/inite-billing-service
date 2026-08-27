// Resolve any hostname to a public IP so the SSRF guard doesn't do real DNS.
// (localhost / private hosts are rejected by name before any lookup.)
jest.mock('dns/promises', () => ({
  lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

// Delivery goes through node:http with the resolved address pinned, so the
// transport is stubbed here rather than `global.fetch`.
jest.mock('../src/workers/pinned-post', () => ({
  postToPinnedAddress: jest.fn(),
}));

import { OutboxService } from '../src/outbox/outbox.service';
import { OutboxProcessor } from '../src/workers/outbox.processor';
import { OutboxScheduler } from '../src/workers/outbox.scheduler';
import { postToPinnedAddress } from '../src/workers/pinned-post';

/**
 * Regression coverage for the outbox delivery path. Before this, the `outbox`
 * queue had no producer, so events were written `new` and never delivered.
 * These tests assert that (1) an emitted event is actually POSTed to an active
 * service webhook and marked `sent`, (2) private/loopback URLs are never hit
 * (SSRF guard), (3) failed deliveries are marked `failed` (and remain
 * retry-eligible), and (4) the scheduler enqueues a single deduplicated drain.
 */
describe('Outbox delivery', () => {
  let mockPrisma: any;
  let service: OutboxService;
  let processor: OutboxProcessor;
  const deliver = postToPinnedAddress as jest.Mock;

  const event = {
    id: 'evt-1',
    eventType: 'billing.payment.succeeded',
    payload: { order_id: 'o1', user_id: 'u1', amount: '20.0000', currency: 'USD' },
    aggregate: {},
    status: 'new',
    attempts: 0,
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
  };

  beforeEach(() => {
    mockPrisma = {
      outboxEvent: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      service: {
        findMany: jest.fn(),
      },
    };
    service = new OutboxService(mockPrisma);
    processor = new OutboxProcessor(service, mockPrisma);
    deliver.mockReset();
  });

  afterEach(() => jest.restoreAllMocks());

  it('POSTs an emitted event to an active public webhook and marks it sent', async () => {
    mockPrisma.outboxEvent.findMany.mockResolvedValue([event]);
    mockPrisma.service.findMany.mockResolvedValue([
      {
        code: 'club',
        isActive: true,
        apiKey: 'club_key',
        webhookUrl: 'https://club.inite.ai/hooks/billing',
      },
    ]);
    deliver.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });

    await processor.process({} as any);

    expect(deliver).toHaveBeenCalledTimes(1);
    const [call] = deliver.mock.calls[0];
    expect(call.url).toBe('https://club.inite.ai/hooks/billing');
    // Delivered to the address the guard vetted, not to the name — resolving
    // again inside the client is the DNS-rebinding window this closes.
    expect(call.addresses).toEqual(['93.184.216.34']);
    expect(call.headers['x-event-id']).toBe('evt-1');
    expect(call.headers['x-event-type']).toBe('billing.payment.succeeded');
    expect(call.headers['x-service-code']).toBe('club');
    expect(JSON.parse(call.body)).toMatchObject({
      type: 'billing.payment.succeeded',
      eventId: 'evt-1',
      data: { order_id: 'o1' },
    });
    // marked sent
    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { status: 'sent', sentAt: expect.any(Date) },
    });
  });

  it('never POSTs to a private/loopback webhook URL (SSRF guard)', async () => {
    mockPrisma.outboxEvent.findMany.mockResolvedValue([event]);
    mockPrisma.service.findMany.mockResolvedValue([
      {
        code: 'evil',
        isActive: true,
        apiKey: 'evil_key',
        webhookUrl: 'http://localhost:3000/steal',
      },
    ]);

    await processor.process({} as any);

    expect(deliver).not.toHaveBeenCalled();
  });

  it('marks an event failed (with attempt increment) when delivery fails', async () => {
    mockPrisma.outboxEvent.findMany.mockResolvedValue([event]);
    mockPrisma.service.findMany.mockResolvedValue([
      {
        code: 'club',
        isActive: true,
        apiKey: 'club_key',
        webhookUrl: 'https://club.inite.ai/hooks/billing',
      },
    ]);
    deliver.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });

    await processor.process({} as any);

    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { status: 'failed', attempts: { increment: 1 }, lastError: expect.any(String) },
    });
  });

  it('getPendingEvents re-selects failed events that still have retry budget', async () => {
    mockPrisma.outboxEvent.findMany.mockResolvedValue([]);
    await service.getPendingEvents(50);
    expect(mockPrisma.outboxEvent.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ status: 'new' }, { status: 'failed', attempts: { lt: 10 } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
  });

  it('scheduler enqueues a single deduplicated drain job', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const scheduler = new OutboxScheduler(queue as any);

    await scheduler.enqueueDrain();

    expect(queue.add).toHaveBeenCalledWith(
      'drain-outbox',
      {},
      { jobId: 'outbox-drain', removeOnComplete: true, removeOnFail: true },
    );
  });
});
