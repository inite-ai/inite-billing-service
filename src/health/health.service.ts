import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../common/services/prisma.service';

export interface DependencyCheck {
  status: 'ok' | 'down' | 'skipped';
  error?: string;
}

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks: {
    database: DependencyCheck;
    redis: DependencyCheck;
  };
}

/**
 * Readiness probing for the dependencies the service cannot work without.
 *
 * `/health` answers whether the process is up, which is all a liveness probe
 * needs — but it answers 200 just as happily when Postgres is unreachable and
 * every request is failing. Anything gating a deploy has to ask a question the
 * dependencies can actually fail.
 */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private redis: Redis | null = null;
  private redisResolved = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    return {
      status: database.status === 'down' || redis.status === 'down' ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      checks: { database, redis },
    };
  }

  private async checkDatabase(): Promise<DependencyCheck> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (error: any) {
      this.logger.warn(`readiness: database down — ${error.message}`);
      return { status: 'down', error: error.message };
    }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    const client = this.getRedis();
    // No REDIS_URL is a deliberate single-instance/dev configuration, not a
    // failure — queues and cron locks degrade in a documented way.
    if (!client) return { status: 'skipped' };

    try {
      const pong = await client.ping();
      return pong === 'PONG' ? { status: 'ok' } : { status: 'down', error: `PING → ${pong}` };
    } catch (error: any) {
      this.logger.warn(`readiness: redis down — ${error.message}`);
      return { status: 'down', error: error.message };
    }
  }

  private getRedis(): Redis | null {
    if (this.redisResolved) return this.redis;
    this.redisResolved = true;

    const url = this.config.get<string>('REDIS_URL');
    if (!url) return (this.redis = null);

    this.redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      // A probe must never hang the endpoint it is reporting on.
      connectTimeout: 2000,
      commandTimeout: 2000,
    });
    this.redis.on('error', (err) => this.logger.debug(`readiness redis error: ${err.message}`));
    return this.redis;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}
