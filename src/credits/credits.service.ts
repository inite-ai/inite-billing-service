import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { CreditBalance, CreditUsage, Prisma } from '@prisma/client';
import { MeteringService } from './metering.service';

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly meteringService?: MeteringService,
  ) {}

  /**
   * Find or create a CreditBalance record for a user+service pair.
   * Accepts either PrismaService or a transaction client as the first argument.
   */
  private async findOrCreateBalance(
    db: any,
    userId: string,
    serviceId?: string,
  ): Promise<CreditBalance> {
    let balance = await db.creditBalance.findUnique({
      where: {
        userId_serviceId: { userId, serviceId: (serviceId ?? null) as any },
      },
    });
    if (!balance) {
      balance = await db.creditBalance.create({
        data: {
          userId,
          serviceId: (serviceId ?? null) as any,
          balance: 0,
          totalGranted: 0,
          totalUsed: 0,
        },
      });
    }
    return balance;
  }

  /**
   * Get or create balance for user+service
   */
  async getBalance(userId: string, serviceId?: string): Promise<CreditBalance> {
    return this.findOrCreateBalance(this.prisma, userId, serviceId);
  }

  /**
   * Get all balances for a user
   */
  async getUserBalances(userId: string): Promise<CreditBalance[]> {
    return this.prisma.creditBalance.findMany({
      where: { userId },
      include: { service: true },
    });
  }

  /**
   * Grant credits (on subscription payment or one-time purchase)
   */
  async grant(data: {
    userId: string;
    serviceId?: string;
    amount: number;
    description?: string;
    orderId?: string;
    resetsAt?: Date;
  }): Promise<CreditBalance> {
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.findOrCreateBalance(tx, data.userId, data.serviceId);

      // Increment balance and totalGranted
      const updated = await tx.creditBalance.update({
        where: { id: balance.id },
        data: {
          balance: { increment: data.amount },
          totalGranted: { increment: data.amount },
          resetsAt: data.resetsAt ?? balance.resetsAt,
        },
      });

      // Create CreditUsage record
      await tx.creditUsage.create({
        data: {
          creditBalanceId: balance.id,
          userId: data.userId,
          amount: data.amount,
          type: 'grant',
          description: data.description ?? 'Credits granted',
          orderId: data.orderId ?? null,
        },
      });

      this.logger.log(
        `Granted ${data.amount} credits to user ${data.userId} (service: ${data.serviceId ?? 'global'})`,
      );

      return updated;
    });
  }

  /**
   * Consume credits (called by external services via API).
   *
   * Two modes, response shape is a strict superset of the legacy contract:
   * - Legacy flat: { amount } — behavior unchanged.
   * - Metered:     { featureCode, units, modelTier? } — credits are computed
   *   from the feature registry, quotas are enforced inside the transaction.
   */
  async consume(data: {
    userId: string;
    serviceId?: string;
    amount?: number;
    featureCode?: string;
    units?: number;
    modelTier?: string;
    description?: string;
    metadata?: Record<string, any>;
  }): Promise<{
    success: boolean;
    remainingBalance: number;
    error?: string;
    creditsCharged?: number;
    quota?: Record<string, any>;
  }> {
    const isMetered = !!data.featureCode;
    if (isMetered) {
      if (!this.meteringService) {
        throw new BadRequestException('Metered consumption is not available');
      }
      if (!data.units || data.units < 1) {
        throw new BadRequestException('units (positive integer) is required with featureCode');
      }
    } else if (typeof data.amount !== 'number' || data.amount < 0) {
      // amount === 0 stays a valid no-op for backwards compatibility
      throw new BadRequestException('Either amount (>= 0) or featureCode+units is required');
    }

    // Feature resolution is cached and happens outside the transaction
    const feature = isMetered
      ? await this.meteringService!.resolveFeature(data.featureCode!)
      : null;
    const chargeAmount = feature
      ? this.meteringService!.computeCredits(feature, data.units!, data.modelTier)
      : data.amount!;

    let softCapCrossed: Array<any> = [];

    const result = await this.prisma.$transaction(async (tx) => {
      if (isMetered) {
        // Row-lock the balance to serialize concurrent metered consumes
        // (closes the quota-evaluation race)
        await tx.$queryRaw(Prisma.sql`
          SELECT id FROM billing.credit_balances
          WHERE user_id = ${data.userId}
            AND service_id IS NOT DISTINCT FROM ${data.serviceId ?? null}::uuid
          FOR UPDATE
        `);
      }

      const balance = await tx.creditBalance.findUnique({
        where: {
          userId_serviceId: {
            userId: data.userId,
            serviceId: (data.serviceId ?? null) as any,
          },
        },
      });

      if (!balance) {
        return {
          success: false,
          remainingBalance: 0,
          error: 'Insufficient credits',
        };
      }

      if (balance.balance < chargeAmount) {
        return {
          success: false,
          remainingBalance: balance.balance,
          error: 'Insufficient credits',
        };
      }

      if (isMetered && feature) {
        const evaluation = await this.meteringService!.evaluateQuotas(tx, {
          userId: data.userId,
          serviceId: data.serviceId,
          balanceId: balance.id,
          featureCode: feature.code,
          featureId: feature.id,
          unitsToAdd: data.units!,
          creditsToAdd: chargeAmount,
        });
        if (evaluation.hardCapHit) {
          // Same non-throwing contract as insufficient credits: no writes
          return {
            success: false,
            remainingBalance: balance.balance,
            error: 'Quota exceeded',
            quota: {
              window: evaluation.hardCapHit.window,
              limitUnits: evaluation.hardCapHit.limitUnits,
              limitCredits: evaluation.hardCapHit.limitCredits,
              usedUnits: evaluation.hardCapHit.usedUnits,
              usedCredits: evaluation.hardCapHit.usedCredits,
            },
          };
        }
        softCapCrossed = evaluation.softCapCrossed;
      }

      // Decrement balance, increment totalUsed
      const updated = await tx.creditBalance.update({
        where: { id: balance.id },
        data: {
          balance: { decrement: chargeAmount },
          totalUsed: { increment: chargeAmount },
        },
      });

      // Create CreditUsage record
      await tx.creditUsage.create({
        data: {
          creditBalanceId: balance.id,
          userId: data.userId,
          amount: -chargeAmount,
          type: 'consume',
          description: data.description ?? (feature ? `${feature.name} usage` : 'Credits consumed'),
          ...(isMetered
            ? {
                featureCode: data.featureCode,
                units: data.units,
                modelTier: data.modelTier ?? null,
              }
            : {}),
          metadata: data.metadata ?? {},
        },
      });

      this.logger.log(
        `Consumed ${chargeAmount} credits from user ${data.userId} (service: ${data.serviceId ?? 'global'}${
          isMetered ? `, feature: ${data.featureCode}, units: ${data.units}` : ''
        })`,
      );

      return {
        success: true,
        remainingBalance: updated.balance,
        ...(isMetered ? { creditsCharged: chargeAmount } : {}),
      };
    });

    // Post-commit soft-cap warnings (fire-and-forget, Redis-deduped)
    if (result.success && softCapCrossed.length > 0) {
      this.meteringService!.emitSoftCapWarnings(data.userId, softCapCrossed);
    }

    return result;
  }

  /**
   * Reset credits (on subscription renewal)
   */
  async resetForPeriod(data: {
    userId: string;
    serviceId?: string;
    newBalance: number;
    resetsAt: Date;
  }): Promise<CreditBalance> {
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.findOrCreateBalance(tx, data.userId, data.serviceId);

      // If current balance > 0, log old balance as reset
      if (balance.balance > 0) {
        await tx.creditUsage.create({
          data: {
            creditBalanceId: balance.id,
            userId: data.userId,
            amount: -balance.balance,
            type: 'reset',
            description: `Period reset: ${balance.balance} credits expired`,
          },
        });
      }

      // Set balance = newBalance, update resetsAt
      const updated = await tx.creditBalance.update({
        where: { id: balance.id },
        data: {
          balance: data.newBalance,
          totalGranted: { increment: data.newBalance },
          resetsAt: data.resetsAt,
        },
      });

      // Log new grant
      await tx.creditUsage.create({
        data: {
          creditBalanceId: balance.id,
          userId: data.userId,
          amount: data.newBalance,
          type: 'grant',
          description: `Period reset: ${data.newBalance} credits granted`,
        },
      });

      this.logger.log(
        `Reset credits for user ${data.userId} (service: ${data.serviceId ?? 'global'}): new balance ${data.newBalance}`,
      );

      return updated;
    });
  }

  /**
   * Admin adjust credits (positive = add, negative = subtract)
   */
  async adminAdjust(data: {
    userId: string;
    serviceId?: string;
    amount: number;
    description: string;
  }): Promise<CreditBalance> {
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.findOrCreateBalance(tx, data.userId, data.serviceId);

      // M5 fix: Check that negative adjustment doesn't result in balance < 0
      if (data.amount < 0 && balance.balance < Math.abs(data.amount)) {
        throw new Error(
          `Cannot adjust by ${data.amount}: current balance is ${balance.balance}. Adjustment would result in negative balance.`,
        );
      }

      const updateData: any = {};
      if (data.amount > 0) {
        updateData.balance = { increment: data.amount };
        updateData.totalGranted = { increment: data.amount };
      } else {
        updateData.balance = { decrement: Math.abs(data.amount) };
        updateData.totalUsed = { increment: Math.abs(data.amount) };
      }

      const updated = await tx.creditBalance.update({
        where: { id: balance.id },
        data: updateData,
      });

      await tx.creditUsage.create({
        data: {
          creditBalanceId: balance.id,
          userId: data.userId,
          amount: data.amount,
          type: 'admin_adjust',
          description: data.description,
        },
      });

      this.logger.log(
        `Admin adjusted ${data.amount} credits for user ${data.userId} (service: ${data.serviceId ?? 'global'}): "${data.description}"`,
      );

      return updated;
    });
  }

  /**
   * Get usage history
   */
  async getUsageHistory(
    userId: string,
    params: {
      serviceId?: string;
      type?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ items: CreditUsage[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (params.type) {
      where.type = params.type;
    }

    if (params.serviceId) {
      where.creditBalance = { serviceId: params.serviceId };
    }

    const [items, total] = await Promise.all([
      this.prisma.creditUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { creditBalance: { include: { service: true } } },
      }),
      this.prisma.creditUsage.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Refund credits (on order refund)
   */
  async refund(data: {
    userId: string;
    serviceId?: string;
    amount: number;
    orderId: string;
  }): Promise<CreditBalance> {
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.findOrCreateBalance(tx, data.userId, data.serviceId);

      const updated = await tx.creditBalance.update({
        where: { id: balance.id },
        data: {
          balance: { increment: data.amount },
          totalGranted: { increment: data.amount },
        },
      });

      await tx.creditUsage.create({
        data: {
          creditBalanceId: balance.id,
          userId: data.userId,
          amount: data.amount,
          type: 'refund',
          description: `Refund for order ${data.orderId}`,
          orderId: data.orderId,
        },
      });

      this.logger.log(
        `Refunded ${data.amount} credits to user ${data.userId} for order ${data.orderId}`,
      );

      return updated;
    });
  }

  /**
   * List all balances with filters (admin)
   */
  async listBalances(params: {
    userId?: string;
    serviceId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: CreditBalance[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.userId) where.userId = params.userId;
    if (params.serviceId) where.serviceId = params.serviceId;

    const [items, total] = await Promise.all([
      this.prisma.creditBalance.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: { service: true },
      }),
      this.prisma.creditBalance.count({ where }),
    ]);

    return { items, total };
  }
}
