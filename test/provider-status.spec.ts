import { ProviderStatusScheduler } from '../src/workers/provider-status.scheduler';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';

/**
 * Settling payments on rails whose webhooks are optional, by asking the
 * provider. The poller only decides *when* to ask; what to do with the answer
 * is the orchestrator's sync, which applies the webhook processor's rules.
 */
describe('provider status polling', () => {
  const NOW = new Date('2026-09-26T12:00:00Z');
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  const build = (opts: { intents?: any[]; subscriptions?: any[]; polling?: boolean } = {}) => {
    const connector: any = {
      capabilities: () => ({ supportedModes: ['PAYMENT'], statusPolling: opts.polling ?? true }),
      syncSubscription: jest.fn().mockResolvedValue(null),
    };
    const prisma: any = {
      paymentProvider: { findMany: jest.fn().mockResolvedValue([{ code: 'LAVA' }]) },
      paymentIntent: { findMany: jest.fn().mockResolvedValue(opts.intents ?? []) },
      subscription: { findMany: jest.fn().mockResolvedValue(opts.subscriptions ?? []) },
    };
    const orchestrator: any = {
      getAdapter: jest.fn(() => connector),
      syncIntentWithProvider: jest.fn().mockResolvedValue({ status: 'created', changed: false }),
      applyStateTransition: jest.fn().mockResolvedValue(undefined),
      handleSubscriptionEvent: jest.fn().mockResolvedValue(undefined),
    };
    const lock: any = {
      runWithLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<void>) => fn()),
    };
    return {
      scheduler: new ProviderStatusScheduler(prisma, orchestrator, lock),
      prisma,
      orchestrator,
      connector,
    };
  };

  it('polls nothing on rails that do not ask for it', async () => {
    const { scheduler, prisma } = build({
      polling: false,
      intents: [{ id: 'pi', createdAt: minutesAgo(1) }],
    });
    await scheduler.poll(NOW);
    expect(prisma.paymentIntent.findMany).not.toHaveBeenCalled();
  });

  it('asks about a fresh payment every run, and applies what the provider says', async () => {
    const { scheduler, orchestrator } = build({
      intents: [{ id: 'pi-1', createdAt: minutesAgo(2) }],
    });
    orchestrator.syncIntentWithProvider.mockResolvedValueOnce({ status: 'paid', changed: true });
    const report = await scheduler.poll(NOW);
    expect(orchestrator.syncIntentWithProvider).toHaveBeenCalledWith('pi-1');
    expect(report).toMatchObject({ checked: 1, settled: 1 });
  });

  it('backs off on older payments', async () => {
    const { scheduler, orchestrator } = build({
      intents: [{ id: 'pi-old', createdAt: minutesAgo(120) }],
    });
    await scheduler.poll(NOW);
    await scheduler.poll(new Date(NOW.getTime() + 60_000));
    expect(orchestrator.syncIntentWithProvider).toHaveBeenCalledTimes(1);
    await scheduler.poll(new Date(NOW.getTime() + 6 * 60_000));
    expect(orchestrator.syncIntentWithProvider).toHaveBeenCalledTimes(2);
  });

  it('expires a payment still unpaid after three days, after asking one last time', async () => {
    const { scheduler, orchestrator } = build({
      intents: [{ id: 'pi-stale', createdAt: minutesAgo(73 * 60) }],
    });
    const report = await scheduler.poll(NOW);
    expect(orchestrator.syncIntentWithProvider).toHaveBeenCalledWith('pi-stale');
    expect(orchestrator.applyStateTransition).toHaveBeenCalledWith('pi-stale', 'expired');
    expect(report.expired).toBe(1);
  });

  it('does not expire one the last check found paid', async () => {
    const { scheduler, orchestrator } = build({
      intents: [{ id: 'pi-late', createdAt: minutesAgo(73 * 60) }],
    });
    orchestrator.syncIntentWithProvider.mockResolvedValueOnce({ status: 'paid', changed: true });
    await scheduler.poll(NOW);
    expect(orchestrator.applyStateTransition).not.toHaveBeenCalled();
  });

  it('keeps going when one provider call fails', async () => {
    const { scheduler, orchestrator } = build({
      intents: [
        { id: 'pi-a', createdAt: minutesAgo(1) },
        { id: 'pi-b', createdAt: minutesAgo(1) },
      ],
    });
    orchestrator.syncIntentWithProvider.mockRejectedValueOnce(new Error('lava.top 503'));
    await scheduler.poll(NOW);
    expect(orchestrator.syncIntentWithProvider).toHaveBeenCalledTimes(2);
  });

  it('turns a provider-side renewal into the renewal event, without a charge id', async () => {
    const sub = {
      id: 'sub-1',
      rail: 'LAVA',
      providerSubscriptionId: 'first-1',
      currentPeriodEnd: minutesAgo(-30),
      status: 'active',
    };
    const { scheduler, orchestrator, connector } = build({ subscriptions: [sub] });
    connector.syncSubscription.mockResolvedValueOnce('subscription.renewed');
    const report = await scheduler.poll(NOW);
    expect(orchestrator.handleSubscriptionEvent).toHaveBeenCalledWith(
      'LAVA',
      'subscription.renewed',
      'first-1',
      {
        source: 'provider-poll',
      },
    );
    expect(report.subscriptionEvents).toBe(1);
  });

  it('runs under the distributed lock', async () => {
    const { scheduler } = build();
    await scheduler.tick();
    expect((scheduler as any).lock.runWithLock).toHaveBeenCalledWith(
      'provider-status-poll',
      expect.any(Number),
      expect.any(Function),
    );
  });
});

describe('PaymentOrchestratorService.syncIntentWithProvider', () => {
  const build = (intent: any, status: any) => {
    const prisma: any = { paymentIntent: { findUnique: jest.fn().mockResolvedValue(intent) } };
    const service = Object.create(PaymentOrchestratorService.prototype);
    Object.assign(service, {
      prisma,
      logger: { warn: jest.fn(), log: jest.fn(), debug: jest.fn() },
      getAdapter: jest.fn(() => ({ getIntentStatus: jest.fn().mockResolvedValue(status) })),
      applyStateTransition: jest.fn().mockResolvedValue(undefined),
    });
    return service as PaymentOrchestratorService & { applyStateTransition: jest.Mock };
  };
  const intent = (o: Record<string, unknown> = {}) => ({
    id: 'pi-1',
    rail: 'LAVA',
    status: 'created',
    providerIntentId: 'c-1',
    order: { amount: '1490', currency: 'RUB' },
    ...o,
  });

  it('settles a payment the provider reports paid in full', async () => {
    const service = build(intent(), {
      status: 'paid',
      amount: 1490,
      currency: 'RUB',
      providerData: { x: 1 },
    });
    await expect(service.syncIntentWithProvider('pi-1')).resolves.toEqual({
      status: 'paid',
      changed: true,
    });
    expect(service.applyStateTransition).toHaveBeenCalledWith('pi-1', 'paid', { x: 1 });
  });

  it('fails one reported paid for less than the order, as the webhook path does', async () => {
    const service = build(intent(), { status: 'paid', amount: 990, currency: 'RUB' });
    await expect(service.syncIntentWithProvider('pi-1')).resolves.toEqual({
      status: 'failed',
      changed: true,
    });
  });

  it('leaves a settled or still-waiting payment alone', async () => {
    const settled = build(intent({ status: 'paid' }), { status: 'paid', amount: 1490 });
    await expect(settled.syncIntentWithProvider('pi-1')).resolves.toEqual({
      status: 'paid',
      changed: false,
    });

    const waiting = build(intent(), { status: 'created' });
    await expect(waiting.syncIntentWithProvider('pi-1')).resolves.toEqual({
      status: 'created',
      changed: false,
    });
    expect(waiting.applyStateTransition).not.toHaveBeenCalled();
  });
});
