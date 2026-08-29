import { BacklogService } from '../src/health/backlog.service';
import { BacklogMonitorScheduler } from '../src/workers/backlog-monitor.scheduler';

/**
 * Readiness answers whether the dependencies are reachable, which is a
 * different question from whether anything is getting done. Both real outages
 * this service has had were of the second kind: the process up, the database
 * reachable, /health green, and a queue quietly filling behind a publisher that
 * had stopped publishing.
 */
describe('backlog', () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

  const build = (state: any) => {
    const prisma: any = {
      outboxEvent: {
        count: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            where.status === 'new' ? state.outboxPending : state.outboxFailed,
          ),
        findFirst: jest
          .fn()
          .mockResolvedValue(state.outboxOldest ? { createdAt: state.outboxOldest } : null),
      },
      webhookEvent: {
        count: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            where.status === 'failed' ? state.webhookFailed : state.webhookPending,
          ),
        findFirst: jest
          .fn()
          .mockResolvedValue(state.webhookOldest ? { receivedAt: state.webhookOldest } : null),
      },
    };
    return new BacklogService(prisma);
  };

  const quiet = {
    outboxPending: 0,
    outboxFailed: 0,
    outboxOldest: null,
    webhookPending: 0,
    webhookFailed: 0,
    webhookOldest: null,
  };

  it('reports nothing stuck when the queues are empty', async () => {
    const report = await build(quiet).report();

    expect(report.stalled).toBe(false);
    expect(report.outbox).toEqual({ pending: 0, failed: 0, oldestPendingSeconds: null });
  });

  it('does not call a fresh backlog a stall', async () => {
    const report = await build({
      ...quiet,
      outboxPending: 40,
      outboxOldest: minutesAgo(2),
    }).report();

    expect(report.stalled).toBe(false);
    expect(report.outbox.oldestPendingSeconds).toBeGreaterThanOrEqual(110);
  });

  it('calls it a stall once something has been waiting a quarter of an hour', async () => {
    const report = await build({
      ...quiet,
      outboxPending: 3,
      outboxOldest: minutesAgo(40),
    }).report();

    expect(report.stalled).toBe(true);
  });

  it('watches webhooks on the same terms', async () => {
    const report = await build({
      ...quiet,
      webhookPending: 1,
      webhookOldest: minutesAgo(30),
    }).report();

    expect(report.stalled).toBe(true);
    expect(report.webhooks.pending).toBe(1);
  });
});

describe('backlog monitor', () => {
  const scheduler = (report: any) => {
    const backlog = { report: jest.fn().mockResolvedValue(report) } as any;
    const lock = { runWithLock: jest.fn((_k: string, _t: number, fn: any) => fn()) } as any;
    const instance = new BacklogMonitorScheduler(backlog, lock);
    const error = jest.spyOn((instance as any).logger, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn((instance as any).logger, 'warn').mockImplementation(() => undefined);
    return { instance, error, warn, backlog };
  };

  const empty = { pending: 0, failed: 0, oldestPendingSeconds: null };

  it('says so, at error level, when work is not moving', async () => {
    const { instance, error } = scheduler({
      outbox: { pending: 120, failed: 0, oldestPendingSeconds: 3600 },
      webhooks: empty,
      stalled: true,
    });

    await instance.reportBacklog();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('120 pending (oldest 60m)'));
  });

  it('mentions events it has given up on even when nothing is stalled', async () => {
    const { instance, warn, error } = scheduler({
      outbox: { pending: 0, failed: 3, oldestPendingSeconds: null },
      webhooks: empty,
      stalled: false,
    });

    await instance.reportBacklog();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('3 outbox event(s)'));
  });

  it('stays quiet when there is nothing to say', async () => {
    const { instance, warn, error } = scheduler({ outbox: empty, webhooks: empty, stalled: false });

    await instance.reportBacklog();

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('does not take the process down when it cannot read the backlog', async () => {
    const { instance, backlog, warn } = scheduler({});
    backlog.report.mockRejectedValue(new Error('database is away'));

    await expect(instance.reportBacklog()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('database is away'));
  });
});
