import { BadRequestException } from '@nestjs/common';
import { MeteringService } from '../src/credits/metering.service';
import { CreditsService } from '../src/credits/credits.service';

describe('MeteringService', () => {
  let service: MeteringService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockNotifications: any;

  const feature = {
    id: 'feat-1',
    code: 'ai.chat.tokens',
    name: 'AI Chat',
    serviceId: null,
    unit: 'tokens',
    creditsPerUnit: 0.001,
    tierRates: { opus: 0.005, haiku: 0.00025 },
    isActive: true,
  };

  beforeEach(() => {
    mockPrisma = {
      meteredFeature: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      featureQuota: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      creditUsage: { groupBy: jest.fn() },
    };
    mockConfig = { get: jest.fn().mockReturnValue(undefined) };
    mockNotifications = { notify: jest.fn().mockResolvedValue([]) };
    service = new MeteringService(mockPrisma, mockConfig, mockNotifications);
  });

  describe('resolveFeature', () => {
    it('resolves an active feature and caches it', async () => {
      mockPrisma.meteredFeature.findFirst.mockResolvedValue(feature);
      const first = await service.resolveFeature('ai.chat.tokens');
      const second = await service.resolveFeature('ai.chat.tokens');
      expect(first).toEqual(feature);
      expect(second).toEqual(feature);
      expect(mockPrisma.meteredFeature.findFirst).toHaveBeenCalledTimes(1);
    });

    it('throws for unknown feature codes', async () => {
      mockPrisma.meteredFeature.findFirst.mockResolvedValue(null);
      await expect(service.resolveFeature('nope')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('computeCredits', () => {
    it('uses the flat rate with ceil rounding', () => {
      expect(service.computeCredits(feature as any, 1500)).toBe(2); // 1.5 -> 2
      expect(service.computeCredits(feature as any, 1000)).toBe(1);
    });

    it('prefers tier rate overrides', () => {
      expect(service.computeCredits(feature as any, 1000, 'opus')).toBe(5);
      expect(service.computeCredits(feature as any, 1000, 'haiku')).toBe(1); // 0.25 -> ceil 1
    });

    it('falls back to flat rate for unknown tiers', () => {
      expect(service.computeCredits(feature as any, 1000, 'unknown')).toBe(1);
    });
  });

  describe('getWindowStart', () => {
    const tx: any = {
      creditUsage: { findFirst: jest.fn() },
      creditBalance: { findUnique: jest.fn() },
    };

    it('computes UTC day start', async () => {
      const start = await service.getWindowStart(tx, 'day', 'bal-1');
      expect(start.getUTCHours()).toBe(0);
      expect(start.getUTCMinutes()).toBe(0);
    });

    it('billing_period uses last grant/reset timestamp', async () => {
      const anchor = new Date('2026-07-01T10:00:00Z');
      tx.creditUsage.findFirst.mockResolvedValue({ createdAt: anchor });
      const start = await service.getWindowStart(tx, 'billing_period', 'bal-1');
      expect(start).toEqual(anchor);
    });

    it('rejects unknown windows', async () => {
      await expect(service.getWindowStart(tx, 'hour', 'bal-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('evaluateQuotas', () => {
    const makeTx = (usedCredits: number, usedUnits: number) =>
      ({
        featureQuota: { findMany: jest.fn() },
        creditUsage: {
          findFirst: jest.fn().mockResolvedValue(null),
          aggregate: jest.fn().mockResolvedValue({
            _sum: { amount: -usedCredits, units: usedUnits },
          }),
        },
        creditBalance: {
          findUnique: jest.fn().mockResolvedValue({ createdAt: new Date(0) }),
        },
      }) as any;

    const input = {
      userId: 'user-1',
      serviceId: undefined,
      balanceId: 'bal-1',
      featureCode: 'ai.chat.tokens',
      featureId: 'feat-1',
      unitsToAdd: 100,
      creditsToAdd: 10,
    };

    const quota = (overrides: Partial<any> = {}) => ({
      id: 'q-1',
      featureId: 'feat-1',
      serviceId: null,
      userId: null,
      window: 'month',
      limitUnits: null,
      limitCredits: 100,
      softCapPct: 80,
      overagePolicy: 'block',
      isActive: true,
      ...overrides,
    });

    it('blocks when the credit limit would be exceeded', async () => {
      const tx = makeTx(95, 0);
      tx.featureQuota.findMany.mockResolvedValue([quota()]);
      const result = await service.evaluateQuotas(tx, input);
      expect(result.hardCapHit).toBeDefined();
      expect(result.hardCapHit!.limitCredits).toBe(100);
    });

    it('passes under the limit and reports soft-cap crossing', async () => {
      const tx = makeTx(75, 0); // 75 -> 85 crosses 80%
      tx.featureQuota.findMany.mockResolvedValue([quota()]);
      const result = await service.evaluateQuotas(tx, input);
      expect(result.hardCapHit).toBeUndefined();
      expect(result.softCapCrossed).toHaveLength(1);
      expect(result.softCapCrossed[0].usagePct).toBe(85);
    });

    it('notify_only policy never blocks', async () => {
      const tx = makeTx(95, 0);
      tx.featureQuota.findMany.mockResolvedValue([
        quota({ overagePolicy: 'notify_only' }),
      ]);
      const result = await service.evaluateQuotas(tx, input);
      expect(result.hardCapHit).toBeUndefined();
    });

    it('per-user quota overrides the default for the same scope', async () => {
      const tx = makeTx(150, 0);
      tx.featureQuota.findMany.mockResolvedValue([
        quota({ id: 'q-default', limitCredits: 100 }),
        quota({ id: 'q-user', userId: 'user-1', limitCredits: 1000 }),
      ]);
      const result = await service.evaluateQuotas(tx, input);
      // The generous per-user override wins — no block at 150+10 < 1000
      expect(result.hardCapHit).toBeUndefined();
    });

    it('unit limits are enforced independently', async () => {
      const tx = makeTx(0, 950);
      tx.featureQuota.findMany.mockResolvedValue([
        quota({ limitCredits: null, limitUnits: 1000 }),
      ]);
      const result = await service.evaluateQuotas(tx, input);
      expect(result.hardCapHit).toBeDefined();
      expect(result.hardCapHit!.limitUnits).toBe(1000);
    });
  });
});

describe('CreditsService metered consume', () => {
  let service: CreditsService;
  let mockPrisma: any;
  let mockTx: any;
  let mockMetering: any;

  const balance = {
    id: 'bal-1',
    userId: 'user-1',
    serviceId: null,
    balance: 100,
    totalGranted: 100,
    totalUsed: 0,
  };

  beforeEach(() => {
    mockTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'bal-1' }]),
      creditBalance: {
        findUnique: jest.fn().mockResolvedValue(balance),
        update: jest.fn().mockResolvedValue({ ...balance, balance: 90 }),
      },
      creditUsage: { create: jest.fn() },
    };
    mockPrisma = { $transaction: jest.fn((fn: any) => fn(mockTx)) };
    mockMetering = {
      resolveFeature: jest.fn().mockResolvedValue({
        id: 'feat-1',
        code: 'ai.chat.tokens',
        name: 'AI Chat',
        creditsPerUnit: 0.001,
        tierRates: {},
      }),
      computeCredits: jest.fn().mockReturnValue(10),
      evaluateQuotas: jest.fn().mockResolvedValue({ softCapCrossed: [] }),
      emitSoftCapWarnings: jest.fn(),
    };
    service = new CreditsService(mockPrisma, mockMetering);
  });

  it('legacy flat consume works without metering calls or row locks', async () => {
    const result = await service.consume({ userId: 'user-1', amount: 10 });
    expect(result.success).toBe(true);
    expect(result.remainingBalance).toBe(90);
    expect(result.creditsCharged).toBeUndefined();
    expect(mockTx.$queryRaw).not.toHaveBeenCalled();
    expect(mockMetering.resolveFeature).not.toHaveBeenCalled();
    const usage = mockTx.creditUsage.create.mock.calls[0][0].data;
    expect(usage.featureCode).toBeUndefined();
    expect(usage.amount).toBe(-10);
  });

  it('metered consume computes credits, locks the row and records structure', async () => {
    const result = await service.consume({
      userId: 'user-1',
      featureCode: 'ai.chat.tokens',
      units: 10000,
      modelTier: 'haiku',
    });
    expect(result.success).toBe(true);
    expect(result.creditsCharged).toBe(10);
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
    const usage = mockTx.creditUsage.create.mock.calls[0][0].data;
    expect(usage.featureCode).toBe('ai.chat.tokens');
    expect(usage.units).toBe(10000);
    expect(usage.modelTier).toBe('haiku');
    expect(usage.amount).toBe(-10);
  });

  it('quota hard cap returns success:false with quota info and no writes', async () => {
    mockMetering.evaluateQuotas.mockResolvedValue({
      hardCapHit: {
        quotaId: 'q-1',
        window: 'month',
        limitUnits: null,
        limitCredits: 100,
        usedUnits: 0,
        usedCredits: 95,
      },
      softCapCrossed: [],
    });
    const result = await service.consume({
      userId: 'user-1',
      featureCode: 'ai.chat.tokens',
      units: 10000,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Quota exceeded');
    expect(result.quota).toMatchObject({ window: 'month', limitCredits: 100 });
    expect(mockTx.creditBalance.update).not.toHaveBeenCalled();
    expect(mockTx.creditUsage.create).not.toHaveBeenCalled();
  });

  it('rejects a request with neither amount nor featureCode', async () => {
    await expect(service.consume({ userId: 'user-1' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects featureCode without units', async () => {
    await expect(
      service.consume({ userId: 'user-1', featureCode: 'ai.chat.tokens' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('fires soft-cap warnings post-commit on success', async () => {
    const warning = {
      quotaId: 'q-1',
      window: 'month',
      windowStart: new Date(),
      softCapPct: 80,
      usagePct: 85,
      featureCode: 'ai.chat.tokens',
    };
    mockMetering.evaluateQuotas.mockResolvedValue({ softCapCrossed: [warning] });
    await service.consume({
      userId: 'user-1',
      featureCode: 'ai.chat.tokens',
      units: 100,
    });
    expect(mockMetering.emitSoftCapWarnings).toHaveBeenCalledWith('user-1', [
      warning,
    ]);
  });
});
