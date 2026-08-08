import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';

/**
 * Redis-backed advisory lock so a `@Cron` job runs on ONE instance at a time.
 *
 * Without it, every replica fires the same sweep on schedule — double-expiring
 * subscriptions, double-settling commissions (a non-idempotent totalEarned
 * increment), enqueuing duplicate payout jobs, and racing renewal webhooks.
 *
 * Fail modes:
 *  - REDIS_URL unset  → run without a lock (explicit single-instance / dev).
 *  - lock held by another instance → skip this tick.
 *  - Redis unreachable → skip (fail closed): pausing a cron for a tick is safer
 *    than risking a double-run, and it self-heals on the next fire.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private redis: Redis | null = null;
  private resolved = false;

  // Atomic check-and-delete so we only release a lock we still own (our token),
  // never one a later holder acquired after ours expired.
  private static readonly RELEASE_LUA =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

  constructor(private readonly config: ConfigService) {}

  private getRedis(): Redis | null {
    if (this.resolved) return this.redis;
    this.resolved = true;
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_URL not set — cron locks disabled (single-instance mode)');
      return (this.redis = null);
    }
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    this.redis.on('error', (err) => this.logger.warn(`lock redis error: ${err.message}`));
    return this.redis;
  }

  /**
   * Run `fn` iff this instance holds the lock `key` for its duration. Returns
   * true if it ran, false if another instance holds the lock or Redis is down.
   * `ttlMs` is a safety expiry (auto-releases if this instance crashes mid-run) —
   * set it comfortably above the job's expected runtime.
   */
  async runWithLock(key: string, ttlMs: number, fn: () => Promise<void>): Promise<boolean> {
    const redis = this.getRedis();
    if (!redis) {
      // No coordination available — run (single-instance / dev).
      await fn();
      return true;
    }

    const lockKey = `lock:cron:${key}`;
    const token = randomBytes(16).toString('hex');

    let acquired: string | null;
    try {
      acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    } catch (err: any) {
      this.logger.warn(`Skipping ${key}: could not acquire lock (${err.message})`);
      return false;
    }

    if (acquired !== 'OK') {
      this.logger.debug(`Skipping ${key}: lock held by another instance`);
      return false;
    }

    try {
      await fn();
      return true;
    } finally {
      try {
        await redis.eval(DistributedLockService.RELEASE_LUA, 1, lockKey, token);
      } catch (err: any) {
        // Not fatal — the TTL will expire the lock.
        this.logger.warn(`Failed to release lock ${key}: ${err.message}`);
      }
    }
  }
}
