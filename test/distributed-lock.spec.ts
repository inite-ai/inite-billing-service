import { DistributedLockService } from '../src/common/locks/distributed-lock.service';

/**
 * The cron lock lets one instance run a scheduled job at a time. It must run the
 * body when it wins the lock, skip when another instance holds it, release
 * afterwards, and behave sanely with no Redis / a broken Redis.
 */
describe('DistributedLockService', () => {
  const withRedis = (redis: any) => {
    const svc = new DistributedLockService({ get: () => 'redis://localhost:6379' } as any);
    (svc as any).redis = redis;
    (svc as any).resolved = true;
    return svc;
  };

  it('runs the body and releases when it wins the lock', async () => {
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };
    const svc = withRedis(redis);
    const fn = jest.fn().mockResolvedValue(undefined);

    const ran = await svc.runWithLock('job', 60_000, fn);

    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    // Acquired with NX + PX ttl.
    expect(redis.set).toHaveBeenCalledWith('lock:cron:job', expect.any(String), 'PX', 60_000, 'NX');
    // Released via the check-and-del script.
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('skips the body when another instance holds the lock', async () => {
    const redis = { set: jest.fn().mockResolvedValue(null), eval: jest.fn() };
    const svc = withRedis(redis);
    const fn = jest.fn();

    const ran = await svc.runWithLock('job', 60_000, fn);

    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled(); // nothing to release
  });

  it('fails closed (skips) when Redis errors on acquire', async () => {
    const redis = { set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), eval: jest.fn() };
    const svc = withRedis(redis);
    const fn = jest.fn();

    const ran = await svc.runWithLock('job', 60_000, fn);

    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('releases even if the body throws', async () => {
    const redis = { set: jest.fn().mockResolvedValue('OK'), eval: jest.fn().mockResolvedValue(1) };
    const svc = withRedis(redis);

    await expect(
      svc.runWithLock('job', 60_000, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(redis.eval).toHaveBeenCalledTimes(1); // released in finally
  });

  it('runs without a lock when REDIS_URL is unset (single-instance mode)', async () => {
    const svc = new DistributedLockService({ get: () => undefined } as any);
    const fn = jest.fn().mockResolvedValue(undefined);

    const ran = await svc.runWithLock('job', 60_000, fn);

    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
