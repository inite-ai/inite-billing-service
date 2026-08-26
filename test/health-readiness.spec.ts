import { ConfigService } from '@nestjs/config';
import { HealthService } from '../src/health/health.service';
import { PrismaService } from '../src/common/services/prisma.service';

/**
 * `/health` answers 200 whether or not the database is reachable — that is what
 * a liveness probe is for. Readiness must not: a deploy gate that cannot fail
 * is the reason a crash-looping image once shipped green.
 */
describe('HealthService readiness', () => {
  const config = (redisUrl?: string) => ({ get: () => redisUrl }) as unknown as ConfigService;

  it('reports ok when the database answers and redis is not configured', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const service = new HealthService(prisma as unknown as PrismaService, config(undefined));

    const report = await service.check();

    expect(report.status).toBe('ok');
    expect(report.checks.database.status).toBe('ok');
    expect(report.checks.redis.status).toBe('skipped');
  });

  it('reports degraded when the database is unreachable', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED 5432')),
    };
    const service = new HealthService(prisma as unknown as PrismaService, config(undefined));

    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.checks.database.status).toBe('down');
    expect(report.checks.database.error).toContain('ECONNREFUSED');
  });

  it('reports degraded when redis is configured but unreachable', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      // Nothing listens here; the client is created lazily with a short timeout.
      config('redis://127.0.0.1:6399'),
    );

    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.checks.database.status).toBe('ok');
    expect(report.checks.redis.status).toBe('down');

    await service.onModuleDestroy();
  });
});
