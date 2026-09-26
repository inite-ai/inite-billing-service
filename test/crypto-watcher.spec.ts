jest.mock('../src/adapters/crypto/watchers', () => ({ watcherFor: jest.fn() }));

import { CryptoWatcherScheduler } from '../src/workers/crypto-watcher.scheduler';
import { watcherFor } from '../src/adapters/crypto/watchers';

const watcherForMock = watcherFor as jest.Mock;

/**
 * The watcher decides nothing about orders: it asks the chains what arrived,
 * hands each transfer to the ledger, and raises an event only when something
 * moved. These pin that — and that one chain's outage does not stop the
 * others, and that an unpaid invoice past its grace period ends its order.
 */
describe('CryptoWatcherScheduler', () => {
  const TRON = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G';
  const provider = (isActive = true) => ({
    isActive,
    config: {
      wallets: { TRON, TON: 'EQDwB8YlfqX_bYO4cGGSkIJYUcgqlij6fhuEwEAhLAppLbEV' },
      lateGraceHours: 24,
    },
  });

  const build = (opts: { provider?: any; targets?: any[]; expired?: any[] } = {}) => {
    const prisma: any = {
      paymentProvider: {
        findUnique: jest.fn().mockResolvedValue('provider' in opts ? opts.provider : provider()),
      },
      paymentIntent: { findFirst: jest.fn().mockResolvedValue({ id: 'pi-expired' }) },
    };
    const adapter: any = {
      ledger: {
        expireStale: jest.fn().mockResolvedValue(opts.expired ?? []),
        watchList: jest.fn().mockResolvedValue(opts.targets ?? []),
        finalTxHashes: jest.fn().mockResolvedValue(new Set()),
      },
      ingest: jest.fn(),
      eventFor: jest.fn((result: any) => ({
        webhookId: `crypto_${result.transfer.txHash}`,
        eventType: 'payment.paid',
        entityId: 'inv',
        payload: {},
      })),
    };
    const orchestrator: any = {
      getAdapter: jest.fn(() => adapter),
      applyStateTransition: jest.fn().mockResolvedValue(undefined),
    };
    const webhooks: any = { storeWebhookEvent: jest.fn().mockResolvedValue(undefined) };
    const lock: any = {
      runWithLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<void>) => fn()),
    };
    const scheduler = new CryptoWatcherScheduler(prisma, orchestrator, webhooks, lock);
    return { scheduler, prisma, adapter, orchestrator, webhooks, lock };
  };

  const target = (chain = 'TRON') => ({
    chain,
    token: 'USDT',
    receiverAddress: TRON,
    since: new Date(),
  });

  beforeEach(() => watcherForMock.mockReset());

  it('does nothing while the rail is off or not configured', async () => {
    for (const p of [null, provider(false)]) {
      const { scheduler, adapter } = build({ provider: p });
      const report = await scheduler.poll();
      expect(report.chains).toEqual([]);
      expect(adapter.ledger.watchList).not.toHaveBeenCalled();
    }
  });

  it('runs under the distributed lock', async () => {
    const { scheduler, lock } = build();
    await scheduler.tick();
    expect(lock.runWithLock).toHaveBeenCalledWith(
      'crypto-watcher',
      expect.any(Number),
      expect.any(Function),
    );
  });

  it('raises an event only for a transfer that is new or moved an invoice forward', async () => {
    const incoming = jest
      .fn()
      .mockResolvedValue([{ txHash: 'a' }, { txHash: 'b' }, { txHash: 'c' }]);
    watcherForMock.mockReturnValue({ incoming });
    const { scheduler, adapter, webhooks } = build({ targets: [target()] });
    adapter.ingest
      .mockResolvedValueOnce({ transfer: { txHash: 'a' }, phase: 'final', created: false })
      .mockResolvedValueOnce({ transfer: { txHash: 'b' }, phase: null, created: false })
      .mockResolvedValueOnce({ transfer: { txHash: 'c' }, phase: null, created: true });

    await scheduler.poll();

    expect(adapter.ingest).toHaveBeenCalledTimes(3);
    expect(webhooks.storeWebhookEvent.mock.calls.map((c: any[]) => c[1])).toEqual([
      'crypto_a',
      'crypto_c',
    ]);
    expect(incoming).toHaveBeenCalledWith(
      expect.objectContaining({
        receiver: TRON,
        token: 'USDT',
        decimals: 6,
        requiredConfirmations: 19,
      }),
    );
    const status = scheduler.lastStatus().find((s) => s.chain === 'TRON');
    expect(status).toMatchObject({ lastError: null, transfersSeen: 3, watching: true });
  });

  it('keeps watching the other chains when one chain’s API fails', async () => {
    watcherForMock.mockImplementation((chain: string) => ({
      incoming:
        chain === 'TRON'
          ? jest.fn().mockRejectedValue(new Error('api.trongrid.io answered 429'))
          : jest.fn().mockResolvedValue([]),
    }));
    const { scheduler } = build({
      targets: [target('TRON'), { ...target('TON'), receiverAddress: 'EQx' }],
    });

    const report = await scheduler.poll();

    const byChain = Object.fromEntries(report.chains.map((c) => [c.chain, c]));
    expect(byChain.TRON.lastError).toContain('429');
    expect(byChain.TON.lastError).toBeNull();
  });

  it('says so when a chain cannot be watched at all', async () => {
    watcherForMock.mockReturnValue(null);
    const { scheduler } = build({ targets: [target('ETH')] });
    const report = await scheduler.poll();
    expect(report.chains.find((c) => c.chain === 'ETH')?.lastError).toContain(
      'No way to watch ETH',
    );
  });

  it('expires the payment of an invoice past its grace period', async () => {
    const { scheduler, orchestrator, prisma } = build({
      expired: [{ invoiceId: 'crypto_TRON_old' }],
    });
    const report = await scheduler.poll();
    expect(report.expired).toBe(1);
    expect(prisma.paymentIntent.findFirst).toHaveBeenCalledWith({
      where: { providerIntentId: 'crypto_TRON_old', rail: 'CRYPTO', status: 'created' },
    });
    expect(orchestrator.applyStateTransition).toHaveBeenCalledWith('pi-expired', 'expired');
  });

  it('reports every chain before its first poll', () => {
    const { scheduler } = build();
    expect(scheduler.lastStatus().map((s) => s.chain)).toEqual([
      'TRON',
      'TON',
      'SOL',
      'ETH',
      'BSC',
      'POLYGON',
      'ARBITRUM',
      'OPTIMISM',
      'BASE',
      'AVAX',
    ]);
    expect(scheduler.lastStatus().every((s) => s.lastPolledAt === null)).toBe(true);
  });
});
