import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Prisma, MeteredFeature, FeatureQuota } from '@prisma/client';
import { PrismaService } from '../common/services/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const FEATURE_CACHE_TTL_MS = 60 * 1000;

export interface QuotaEvaluation {
  hardCapHit?: {
    quotaId: string;
    window: string;
    limitUnits: number | null;
    limitCredits: number | null;
    usedUnits: number;
    usedCredits: number;
  };
  softCapCrossed: Array<{
    quotaId: string;
    window: string;
    windowStart: Date;
    softCapPct: number;
    usagePct: number;
    featureCode: string | null;
  }>;
}

@Injectable()
export class MeteringService {
  private readonly logger = new Logger(MeteringService.name);
  private readonly featureCache = new Map<string, { feature: MeteredFeature | null; at: number }>();
  private redis: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private getRedis(): Redis | null {
    if (this.redis) return this.redis;
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return null;
    try {
      this.redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
      this.redis.on('error', (err) =>
        this.logger.warn(`Redis error (soft-cap dedupe): ${err.message}`),
      );
      return this.redis;
    } catch {
      return null;
    }
  }

  // ─── Feature resolution & pricing ───────────────────────────

  async resolveFeature(code: string): Promise<MeteredFeature> {
    const cached = this.featureCache.get(code);
    if (cached && Date.now() - cached.at < FEATURE_CACHE_TTL_MS) {
      if (!cached.feature) {
        throw new BadRequestException(`Unknown or inactive feature code: ${code}`);
      }
      return cached.feature;
    }
    const feature = await this.prisma.meteredFeature.findFirst({
      where: { code, isActive: true },
    });
    this.featureCache.set(code, { feature, at: Date.now() });
    if (!feature) {
      throw new BadRequestException(`Unknown or inactive feature code: ${code}`);
    }
    return feature;
  }

  computeCredits(feature: MeteredFeature, units: number, modelTier?: string): number {
    const tierRates = (feature.tierRates ?? {}) as Record<string, number>;
    const rate =
      modelTier && typeof tierRates[modelTier] === 'number'
        ? tierRates[modelTier]
        : Number(feature.creditsPerUnit);
    return Math.ceil(units * rate);
  }

  // ─── Quota windows ──────────────────────────────────────────

  async getWindowStart(
    tx: Prisma.TransactionClient,
    window: string,
    balanceId: string,
  ): Promise<Date> {
    const now = new Date();
    switch (window) {
      case 'day':
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      case 'week': {
        const day = now.getUTCDay() || 7; // Monday-based
        const monday = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1),
        );
        return monday;
      }
      case 'month':
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      case 'billing_period': {
        const lastReset = await tx.creditUsage.findFirst({
          where: {
            creditBalanceId: balanceId,
            type: { in: ['reset', 'grant'] },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        if (lastReset) return lastReset.createdAt;
        const balance = await tx.creditBalance.findUnique({
          where: { id: balanceId },
          select: { createdAt: true },
        });
        return balance?.createdAt ?? new Date(0);
      }
      default:
        throw new BadRequestException(`Unknown quota window: ${window}`);
    }
  }

  /**
   * Evaluate quotas inside the consume transaction (the caller holds a
   * row lock on the balance, serializing concurrent consumes).
   * Per-user quota rows override default (userId=null) rows for the same
   * (featureId, serviceId, window).
   */
  async evaluateQuotas(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      serviceId?: string;
      balanceId: string;
      featureCode: string;
      featureId: string;
      unitsToAdd: number;
      creditsToAdd: number;
    },
  ): Promise<QuotaEvaluation> {
    const quotas = await tx.featureQuota.findMany({
      where: {
        isActive: true,
        OR: [{ featureId: input.featureId }, { featureId: null }],
        AND: [
          { OR: [{ serviceId: input.serviceId ?? null }, { serviceId: null }] },
          { OR: [{ userId: input.userId }, { userId: null }] },
        ],
      },
    });

    // Per-user overrides win over defaults within the same scope group
    const byScope = new Map<string, FeatureQuota>();
    for (const quota of quotas) {
      const key = `${quota.featureId ?? '-'}:${quota.serviceId ?? '-'}:${quota.window}`;
      const existing = byScope.get(key);
      if (!existing || (quota.userId && !existing.userId)) {
        byScope.set(key, quota);
      }
    }

    const result: QuotaEvaluation = { softCapCrossed: [] };

    for (const quota of byScope.values()) {
      const windowStart = await this.getWindowStart(tx, quota.window, input.balanceId);
      const aggregate = await tx.creditUsage.aggregate({
        where: {
          userId: input.userId,
          creditBalanceId: input.balanceId,
          type: 'consume',
          createdAt: { gte: windowStart },
          ...(quota.featureId ? { featureCode: input.featureCode } : {}),
        },
        _sum: { amount: true, units: true },
      });
      const usedCredits = Math.abs(aggregate._sum.amount ?? 0);
      const usedUnits = Math.abs(aggregate._sum.units ?? 0);

      const projectedCredits = usedCredits + input.creditsToAdd;
      const projectedUnits = usedUnits + input.unitsToAdd;

      const creditsOver = quota.limitCredits != null && projectedCredits > quota.limitCredits;
      const unitsOver = quota.limitUnits != null && projectedUnits > quota.limitUnits;

      if ((creditsOver || unitsOver) && quota.overagePolicy === 'block') {
        result.hardCapHit = {
          quotaId: quota.id,
          window: quota.window,
          limitUnits: quota.limitUnits,
          limitCredits: quota.limitCredits,
          usedUnits,
          usedCredits,
        };
        return result;
      }

      // Soft-cap detection (crossing the threshold with this consume)
      const limit = quota.limitCredits ?? quota.limitUnits;
      if (limit != null && limit > 0) {
        const used = quota.limitCredits != null ? usedCredits : usedUnits;
        const projected = quota.limitCredits != null ? projectedCredits : projectedUnits;
        const threshold = (limit * quota.softCapPct) / 100;
        if (used < threshold && projected >= threshold) {
          result.softCapCrossed.push({
            quotaId: quota.id,
            window: quota.window,
            windowStart,
            softCapPct: quota.softCapPct,
            usagePct: Math.min(100, Math.round((projected / limit) * 100)),
            featureCode: quota.featureId ? input.featureCode : null,
          });
        }
      }
    }

    return result;
  }

  /**
   * Post-commit soft-cap warnings, deduped per (user, quota, window) via
   * Redis SETNX with TTL. Fire-and-forget — never blocks the consume path.
   */
  emitSoftCapWarnings(userId: string, warnings: QuotaEvaluation['softCapCrossed']): void {
    if (warnings.length === 0) return;
    void (async () => {
      for (const warning of warnings) {
        try {
          const redis = this.getRedis();
          if (redis) {
            const key = `quota-warn:${userId}:${warning.quotaId}:${warning.windowStart.toISOString()}`;
            const set = await redis.set(key, '1', 'EX', 40 * 86400, 'NX');
            if (set === null) continue; // already warned this window
          }
          await this.notificationsService.notify({
            userId,
            type: 'quota_warning',
            channels: ['in_app', 'email'],
            title:
              warning.usagePct >= 100
                ? 'Usage limit reached'
                : `You've used ${warning.usagePct}% of your usage limit`,
            body: `Your ${warning.featureCode ?? 'credit'} usage has reached ${warning.usagePct}% of the ${warning.window} limit. Once the limit is hit, further operations will be paused until it resets.`,
            metadata: { quotaId: warning.quotaId, usagePct: warning.usagePct },
          });
        } catch (error: any) {
          this.logger.warn(`Soft-cap warning failed: ${error.message}`);
        }
      }
    })();
  }

  // ─── Feature & quota CRUD (admin) ───────────────────────────

  async listFeatures(includeInactive = false) {
    return this.prisma.meteredFeature.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { service: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createFeature(data: {
    code: string;
    name: string;
    serviceId?: string;
    unit: string;
    creditsPerUnit: number;
    tierRates?: Record<string, number>;
    isActive?: boolean;
  }) {
    this.featureCache.delete(data.code);
    return this.prisma.meteredFeature.create({
      data: {
        code: data.code,
        name: data.name,
        serviceId: data.serviceId ?? null,
        unit: data.unit,
        creditsPerUnit: data.creditsPerUnit,
        tierRates: data.tierRates ?? {},
        isActive: data.isActive ?? true,
      },
    });
  }

  async updateFeature(
    id: string,
    data: Partial<{
      name: string;
      serviceId: string | null;
      unit: string;
      creditsPerUnit: number;
      tierRates: Record<string, number>;
      isActive: boolean;
    }>,
  ) {
    const updated = await this.prisma.meteredFeature.update({
      where: { id },
      data,
    });
    this.featureCache.delete(updated.code);
    return updated;
  }

  async deleteFeature(id: string) {
    const feature = await this.prisma.meteredFeature.delete({ where: { id } });
    this.featureCache.delete(feature.code);
    return feature;
  }

  async listQuotas(filters: { featureId?: string; userId?: string } = {}) {
    return this.prisma.featureQuota.findMany({
      where: {
        ...(filters.featureId ? { featureId: filters.featureId } : {}),
        ...(filters.userId ? { userId: filters.userId } : {}),
      },
      include: { feature: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createQuota(data: {
    featureId?: string;
    serviceId?: string;
    userId?: string;
    window: string;
    limitUnits?: number;
    limitCredits?: number;
    softCapPct?: number;
    overagePolicy?: string;
  }) {
    if (data.limitUnits == null && data.limitCredits == null) {
      throw new BadRequestException('At least one of limitUnits or limitCredits is required');
    }
    return this.prisma.featureQuota.create({
      data: {
        featureId: data.featureId ?? null,
        serviceId: data.serviceId ?? null,
        userId: data.userId ?? null,
        window: data.window,
        limitUnits: data.limitUnits ?? null,
        limitCredits: data.limitCredits ?? null,
        softCapPct: data.softCapPct ?? 80,
        overagePolicy: data.overagePolicy ?? 'block',
      },
    });
  }

  async updateQuota(
    id: string,
    data: Partial<{
      limitUnits: number | null;
      limitCredits: number | null;
      softCapPct: number;
      overagePolicy: string;
      isActive: boolean;
    }>,
  ) {
    return this.prisma.featureQuota.update({ where: { id }, data });
  }

  async deleteQuota(id: string) {
    return this.prisma.featureQuota.delete({ where: { id } });
  }

  // ─── Usage analytics ────────────────────────────────────────

  async getUsageBreakdown(params: {
    userId?: string;
    serviceId?: string;
    featureCode?: string;
    from?: Date;
    to?: Date;
    groupBy?: 'feature' | 'day' | 'service';
  }) {
    const from = params.from ?? new Date(Date.now() - 30 * 86_400_000);
    const to = params.to ?? new Date();
    const groupBy = params.groupBy ?? 'feature';

    if (groupBy === 'day') {
      const rows = await this.prisma.$queryRaw<
        Array<{
          bucket: Date;
          feature_code: string | null;
          total_credits: bigint;
          total_units: bigint;
          event_count: bigint;
        }>
      >(Prisma.sql`
        SELECT date_trunc('day', cu.created_at) AS bucket,
               cu.feature_code,
               SUM(ABS(cu.amount))::bigint AS total_credits,
               COALESCE(SUM(cu.units), 0)::bigint AS total_units,
               COUNT(*)::bigint AS event_count
        FROM billing.credit_usages cu
        WHERE cu.type = 'consume'
          AND cu.created_at >= ${from} AND cu.created_at <= ${to}
          ${params.userId ? Prisma.sql`AND cu.user_id = ${params.userId}` : Prisma.empty}
          ${params.featureCode ? Prisma.sql`AND cu.feature_code = ${params.featureCode}` : Prisma.empty}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `);
      return rows.map((row) => ({
        bucket: row.bucket,
        featureCode: row.feature_code,
        totalCredits: Number(row.total_credits),
        totalUnits: Number(row.total_units),
        eventCount: Number(row.event_count),
      }));
    }

    const grouped = await this.prisma.creditUsage.groupBy({
      by: ['featureCode'],
      where: {
        type: 'consume',
        createdAt: { gte: from, lte: to },
        ...(params.userId ? { userId: params.userId } : {}),
        ...(params.featureCode ? { featureCode: params.featureCode } : {}),
        ...(params.serviceId ? { creditBalance: { serviceId: params.serviceId } } : {}),
      },
      _sum: { amount: true, units: true },
      _count: { _all: true },
    });

    const featureCodes = grouped.map((g) => g.featureCode).filter(Boolean) as string[];
    const features = featureCodes.length
      ? await this.prisma.meteredFeature.findMany({
          where: { code: { in: featureCodes } },
          select: { code: true, name: true, unit: true },
        })
      : [];
    const featureMap = new Map(features.map((f) => [f.code, f]));

    return grouped
      .map((g) => ({
        featureCode: g.featureCode,
        featureName: g.featureCode
          ? (featureMap.get(g.featureCode)?.name ?? g.featureCode)
          : 'Unmetered',
        unit: g.featureCode ? (featureMap.get(g.featureCode)?.unit ?? null) : null,
        totalCredits: Math.abs(g._sum.amount ?? 0),
        totalUnits: Math.abs(g._sum.units ?? 0),
        eventCount: g._count._all,
      }))
      .sort((a, b) => b.totalCredits - a.totalCredits);
  }
}
