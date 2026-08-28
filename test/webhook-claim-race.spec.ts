import { WebhookProcessor } from '../src/workers/webhook.processor';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';

/**
 * Two deliveries of the same webhook — a provider retry racing the original,
 * or two workers on one queue — could both fulfil the payment: two invoices,
 * two credit grants, two entitlements, two commissions, two events.
 *
 * There were two holes, and both are closed here. The claim allowed
 * `processing` through, so a second worker matched a row the first was already
 * holding. And the state transition read the intent without a lock, so even a
 * correct claim would not have saved a caller that reached the orchestrator
 * directly.
 */
describe('WebhookProcessor claim', () => {
  const event = {
    id: 'evt-1',
    rail: 'STRIPE',
    webhookId: 'wh_1',
    eventType: 'payment.succeeded',
    entityId: 'pi_1',
    status: 'received',
    attempts: 0,
    receivedAt: new Date('2026-08-28T00:00:00Z'),
    processedAt: null as Date | null,
    payload: {},
  };

  const build = (row: Partial<typeof event> = {}, claimedCount = 1) => {
    const updateMany = jest.fn().mockResolvedValue({ count: claimedCount });
    const prisma: any = {
      webhookEvent: {
        findUnique: jest.fn().mockResolvedValue({ ...event, ...row }),
        update: jest.fn().mockResolvedValue({}),
        updateMany,
      },
      paymentIntent: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const orchestrator: any = {
      getAdapter: jest.fn().mockReturnValue({
        getIntentStatus: jest.fn().mockResolvedValue({ status: 'paid' }),
      }),
      applyStateTransition: jest.fn(),
      handleSubscriptionEvent: jest.fn(),
    };
    return {
      processor: new WebhookProcessor(prisma, orchestrator),
      prisma,
      updateMany,
      orchestrator,
    };
  };

  const run = (processor: WebhookProcessor) =>
    processor.process({ data: { rail: 'STRIPE', webhookId: 'wh_1' } } as any);

  it('does not claim an event another worker is holding', async () => {
    const { processor, updateMany, orchestrator } = build({ status: 'received' }, 0);

    await run(processor);

    // The claim matched nothing — someone else has it, so we stop.
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(orchestrator.getAdapter).not.toHaveBeenCalled();
  });

  it('refuses a fresh in-flight claim rather than joining it', async () => {
    const { processor, updateMany } = build({
      status: 'processing',
      processedAt: new Date(),
    });

    await run(processor);

    const where = updateMany.mock.calls[0][0].where;
    // `processing` on its own is never claimable: every branch that admits it
    // also demands an expired lease.
    const bare = where.OR.find((c: any) => c.status === 'processing' && !('processedAt' in c));
    expect(bare).toBeUndefined();
    expect(where.OR).toEqual(expect.arrayContaining([{ status: { in: ['received', 'failed'] } }]));
  });

  it('takes over an event whose holder died, using the lease stamp', async () => {
    const { processor, updateMany } = build({
      status: 'processing',
      processedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    await run(processor);

    const where = updateMany.mock.calls[0][0].where;
    const expired = where.OR.find(
      (c: any) => c.status === 'processing' && c.processedAt?.lt instanceof Date,
    );
    expect(expired).toBeDefined();
    // The winner moves the deadline, so the loser's identical claim matches none.
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'processing' });
    expect(updateMany.mock.calls[0][0].data.processedAt).toBeInstanceOf(Date);
  });

  it('leaves a processed event alone', async () => {
    const { processor, updateMany } = build({ status: 'processed' });
    await run(processor);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('applyStateTransition locking', () => {
  it('locks the intent row before reading its state', async () => {
    const calls: string[] = [];
    const tx: any = {
      $queryRaw: jest.fn().mockImplementation(async (q: any) => {
        calls.push(`lock:${String(q.strings?.join('?') ?? q)}`);
        return [];
      }),
      paymentIntent: {
        findUnique: jest.fn().mockImplementation(async () => {
          calls.push('read');
          return { id: 'pi-1', status: 'paid', orderId: 'o1', order: { status: 'paid' } };
        }),
        update: jest.fn(),
      },
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    const service = new PaymentOrchestratorService(
      prisma,
      { emit: jest.fn() } as any,
      {} as any,
      { track: jest.fn() } as any,
      {} as any,
    );

    // Already in the target state: the point is the ORDER of lock and read.
    await service.applyStateTransition('pi-1', 'paid' as any);

    expect(calls[0]).toContain('FOR UPDATE');
    expect(calls[1]).toBe('read');
    expect(tx.paymentIntent.update).not.toHaveBeenCalled();
  });
});
