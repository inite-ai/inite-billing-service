import { WebhooksService } from '../src/webhooks/webhooks.service';
import { WebhookRecoveryScheduler } from '../src/workers/webhook-recovery.scheduler';
import {
  SUBSCRIPTION_EVENT_TYPES,
  isSubscriptionEvent,
} from '../src/payment-orchestrator/payment-orchestrator.service';

/**
 * Storing a webhook and queueing it are two steps, and everything between them
 * used to be a way to lose a paid order's notification for good: the row was
 * written, the enqueue failed, the provider's retry hit the unique constraint,
 * and the duplicate branch returned having queued nothing.
 */
describe('WebhooksService.storeWebhookEvent', () => {
  const build = (createError?: any, existing?: { status: string } | null) => {
    const create = createError
      ? jest.fn().mockRejectedValue(createError)
      : jest.fn().mockResolvedValue({});
    const prisma: any = {
      webhookEvent: {
        create,
        findUnique: jest.fn().mockResolvedValue(existing ?? null),
      },
    };
    const queue: any = { add: jest.fn().mockResolvedValue({}) };
    return { service: new WebhooksService(prisma, queue), queue, prisma };
  };

  const store = (service: WebhooksService) =>
    service.storeWebhookEvent('STRIPE', 'wh_1', 'payment.paid', 'pi_1', {});

  const duplicate = { code: 'P2002' };

  it('queues a newly stored event', async () => {
    const { service, queue } = build();
    await store(service);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('re-queues an event that was stored but never queued', async () => {
    const { service, queue } = build(duplicate, { status: 'received' });

    await store(service);

    // This is the case that lost webhooks: the row exists, nobody is working
    // on it, and the provider's retry is the only second chance there will be.
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('re-queues an event whose processing failed', async () => {
    const { service, queue } = build(duplicate, { status: 'failed' });
    await store(service);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('leaves an event alone while a worker holds it', async () => {
    const { service, queue } = build(duplicate, { status: 'processing' });
    await store(service);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('leaves a finished event alone', async () => {
    const { service, queue } = build(duplicate, { status: 'processed' });
    await store(service);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('uses a job id derived from the event, so re-queues collapse', async () => {
    const { service, queue } = build();
    await store(service);
    expect(queue.add.mock.calls[0][2]).toMatchObject({ jobId: 'webhook:STRIPE:wh_1' });
  });

  it('still surfaces a real database error', async () => {
    const { service } = build(Object.assign(new Error('connection lost'), { code: 'P1001' }));
    await expect(store(service)).rejects.toThrow('connection lost');
  });
});

describe('WebhookRecoveryScheduler', () => {
  const build = (rows: any[]) => {
    const prisma: any = { webhookEvent: { findMany: jest.fn().mockResolvedValue(rows) } };
    const queue: any = { add: jest.fn().mockResolvedValue({}) };
    const lock: any = { runWithLock: jest.fn((_k: string, _t: number, fn: any) => fn()) };
    return { scheduler: new WebhookRecoveryScheduler(prisma, lock, queue), queue, prisma, lock };
  };

  it('re-queues rows the queue lost, under the same job id', async () => {
    const { scheduler, queue } = build([
      { rail: 'STRIPE', webhookId: 'wh_1', status: 'received' },
      { rail: 'LAVA', webhookId: 'wh_2', status: 'processing' },
    ]);

    await scheduler.sweep();

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0][2].jobId).toBe('webhook:STRIPE:wh_1');
  });

  it('looks for rows nobody is working on, not for fresh ones', async () => {
    const { scheduler, prisma } = build([]);

    await scheduler.sweep();

    const where = prisma.webhookEvent.findMany.mock.calls[0][0].where;
    // A webhook that arrived a second ago is not stranded — it is in flight.
    const received = where.OR.find((c: any) => c.status === 'received');
    expect(received.receivedAt.lt).toBeInstanceOf(Date);
    expect(received.receivedAt.lt.getTime()).toBeLessThan(Date.now());
    expect(where.OR.some((c: any) => c.status === 'processing')).toBe(true);
  });

  it('takes the lock, so replicas do not all sweep at once', async () => {
    const { scheduler, lock } = build([]);
    await scheduler.sweep();
    expect(lock.runWithLock).toHaveBeenCalledWith('webhook-recovery', 60_000, expect.any(Function));
  });

  it('does nothing when there is nothing stranded', async () => {
    const { scheduler, queue } = build([]);
    await scheduler.sweep();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('subscription event routing', () => {
  it('covers every subscription event the rails emit', () => {
    // The set used to be three long while the adapters emit ten; the other
    // seven went down the payment-intent path, matched nothing, and were
    // retried until abandoned — so an expired store subscription never ended.
    for (const type of [
      'subscription.expired',
      'subscription.on_hold',
      'subscription.grace_period',
      'subscription.recovered',
      'subscription.restarted',
      'subscription.created',
      'subscription.updated',
    ]) {
      expect(isSubscriptionEvent(type)).toBe(true);
    }
    expect(SUBSCRIPTION_EVENT_TYPES).toHaveLength(10);
  });

  it('does not swallow payment events', () => {
    expect(isSubscriptionEvent('payment.paid')).toBe(false);
    expect(isSubscriptionEvent('payment.refunded')).toBe(false);
  });
});
