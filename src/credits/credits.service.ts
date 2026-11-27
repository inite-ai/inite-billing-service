import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { CreditBalance, CreditUsage, Prisma } from '@prisma/client';
import { MeteringService } from './metering.service';
import { OutboxService } from '../outbox/outbox.service';
import type { CreditGrantSource } from './credit-company';
import {
  CREDITS_GRANTED,
  CREDITS_REVOKED,
  creditGrantedPayload,
  creditRevokedPayload,
} from './credit-events';

import { resolveOrderBy, SortWhitelist } from '../common/helpers/sort';

export const CREDIT_BALANCE_SORT: SortWhitelist = {
  updatedAt: ['updatedAt'],
  balance: ['balance'],
  userId: ['userId'],
};

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly meteringService: MeteringService | undefined,
    private readonly outbox: OutboxService,
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
    // A platform-wide balance has no service, and a compound unique lookup
    // cannot express that: Prisma rejects a null inside `userId_serviceId`
    // outright ("Argument `serviceId` must not be null"), so every credit
    // operation that named no service threw before it did anything. A filter
    // takes null and means IS NULL, which is what was wanted all along.
    const scope = { userId, serviceId: serviceId ?? null };

    const existing = await db.creditBalance.findFirst({ where: scope });
    if (existing) return existing;

    try {
      return await db.creditBalance.create({
        data: { ...scope, balance: 0, totalGranted: 0, totalUsed: 0 },
      });
    } catch (error: any) {
      // Two first-time grants for the same scope can race between the read and
      // the insert; the unique index decides, and the loser reads the winner's
      // row. Inside a transaction the conflict has already aborted it, so this
      // rethrows and the caller retries the whole thing.
      if (error?.code === 'P2002') {
        const raced = await db.creditBalance.findFirst({ where: scope });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * The balance, locked and read behind the lock. Every write that depends on
   * what the buckets hold goes through here, so a renewal, a consume and a
   * refund of the same balance happen one after another.
   */
  private async lockBalance(db: any, userId: string, serviceId?: string): Promise<CreditBalance> {
    const balance = await this.findOrCreateBalance(db, userId, serviceId);
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM billing.credit_balances WHERE id = ${balance.id}::uuid FOR UPDATE`,
    );
    return (await db.creditBalance.findUnique({ where: { id: balance.id } })) ?? balance;
  }

  /** Behind the balance lock: whether this order has granted its credits already. */
  private async alreadyGranted(db: any, balanceId: string, orderId?: string): Promise<boolean> {
    if (!orderId) return false;
    const row = await db.creditUsage.findFirst({
      where: { creditBalanceId: balanceId, orderId, type: 'grant' },
    });
    if (row) this.logger.warn(`Credits for order ${orderId} were already granted — skipping`);
    return !!row;
  }

  /** The ledger row of a grant, and its event in the same transaction. */
  private async recordGrant(
    db: any,
    balance: CreditBalance,
    grant: {
      amount: number;
      bucket: 'period' | 'purchased';
      description: string;
      orderId?: string;
      source?: CreditGrantSource;
    },
  ): Promise<void> {
    const { source } = grant;
    const periodStart = source?.periodStart?.toISOString() ?? null;
    const periodEnd = source?.periodEnd?.toISOString() ?? null;
    const companyId = source?.companyId ?? null;
    const row = await db.creditUsage.create({
      data: {
        creditBalanceId: balance.id,
        userId: balance.userId,
        amount: grant.amount,
        type: 'grant',
        description: grant.description,
        orderId: grant.orderId ?? null,
        metadata: {
          bucket: grant.bucket,
          ...(source ? { source: source.source, periodStart, periodEnd, companyId } : {}),
        },
      },
    });
    // Built from the row as stored, as GET /v1/service-credits/grants builds it.
    const payload = creditGrantedPayload(row);
    if (!payload) return;
    await this.outbox.emit(CREDITS_GRANTED, payload, { serviceId: balance.serviceId, tx: db });
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
   * Grant credits (on subscription payment or one-time purchase).
   *
   * Pass `tx` to run inside an existing transaction (e.g. the payment
   * fulfilment tx) so the grant commits or rolls back atomically with the
   * order — otherwise a rollback leaves phantom credits and a grant failure is
   * invisible to the paid order. Called standalone, it opens its own tx.
   */
  async grant(
    data: {
      userId: string;
      serviceId?: string;
      amount: number;
      description?: string;
      orderId?: string;
      resetsAt?: Date;
      /** `period` credits expire with the next period; the default never do. */
      bucket?: 'period' | 'purchased';
      source?: CreditGrantSource;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<CreditBalance> {
    const run = async (db: Prisma.TransactionClient) => {
      const balance = await this.lockBalance(db, data.userId, data.serviceId);
      if (await this.alreadyGranted(db, balance.id, data.orderId)) return balance;

      // `balance` is the total of both buckets; what is not period is purchased.
      const updated = await db.creditBalance.update({
        where: { id: balance.id },
        data: {
          balance: { increment: data.amount },
          totalGranted: { increment: data.amount },
          ...(data.bucket === 'period' ? { periodBalance: { increment: data.amount } } : {}),
          resetsAt: data.resetsAt ?? balance.resetsAt,
        },
      });

      await this.recordGrant(db, balance, {
        amount: data.amount,
        bucket: data.bucket ?? 'purchased',
        description: data.description ?? 'Credits granted',
        orderId: data.orderId,
        source: data.source,
      });

      this.logger.log(
        `Granted ${data.amount} credits to user ${data.userId} (service: ${data.serviceId ?? 'global'})`,
      );

      return updated;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
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
    /**
     * Charge once for this key, however many times the call arrives. Agents
     * retry on their own — a timeout, a dropped connection, a tool the model
     * decides to call again — and without this every retry is a second debit.
     */
    idempotencyKey?: string;
  }): Promise<{
    success: boolean;
    remainingBalance: number;
    error?: string;
    creditsCharged?: number;
    quota?: Record<string, any>;
    /** True when an idempotency key matched an earlier charge and nothing moved. */
    replayed?: boolean;
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
      // Row-lock the balance up front to serialize concurrent consumes on the
      // same (userId, serviceId). BOTH paths read the balance, check it, then
      // decrement — without this lock two concurrent requests can each pass the
      // balance check on the same funds and drive the ledger negative
      // (double-spend). The metered path additionally relies on the lock to make
      // its quota evaluation race-free. FOR UPDATE locks the existing row; when
      // no balance row exists the consume fails the check anyway (nothing to
      // over-spend), so locking only existing rows is sufficient here.
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM billing.credit_balances
        WHERE user_id = ${data.userId}
          AND service_id IS NOT DISTINCT FROM ${data.serviceId ?? null}::uuid
        FOR UPDATE
      `);

      // Behind the same lock: a key already charged is reported as the success
      // it was, without charging again. The unique index is the backstop for
      // anything that reaches here without the lock.
      if (data.idempotencyKey) {
        const already = await tx.creditUsage.findFirst({
          where: { userId: data.userId, idempotencyKey: data.idempotencyKey },
        });
        if (already) {
          const current = await tx.creditBalance.findFirst({
            where: { userId: data.userId, serviceId: data.serviceId ?? null },
          });
          return {
            success: true,
            remainingBalance: current?.balance ?? 0,
            replayed: true,
            ...(isMetered ? { creditsCharged: Math.abs(already.amount) } : {}),
          };
        }
      }

      const balance = await tx.creditBalance.findFirst({
        where: { userId: data.userId, serviceId: data.serviceId ?? null },
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

      const fromPeriod = Math.min(chargeAmount, Math.max(balance.periodBalance ?? 0, 0));

      // Decrement balance, increment totalUsed
      const updated = await tx.creditBalance.update({
        where: { id: balance.id },
        data: {
          balance: { decrement: chargeAmount },
          totalUsed: { increment: chargeAmount },
          // The credits that expire are spent first.
          ...(fromPeriod > 0 ? { periodBalance: { decrement: fromPeriod } } : {}),
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
          idempotencyKey: data.idempotencyKey ?? null,
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
   * Start a credit period (on subscription payment): what is left of the last
   * period expires, purchased credits stay.
   *
   * `orderId` is stamped on the ledger rows so a later refund of that order can
   * find what this period granted. Without it the subscription grant was
   * anonymous, and refunding a subscription payment took back nothing at all.
   */
  async resetForPeriod(
    data: {
      userId: string;
      serviceId?: string;
      newBalance: number;
      resetsAt: Date;
      orderId?: string;
      source?: CreditGrantSource;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<CreditBalance> {
    const run = async (db: Prisma.TransactionClient) => {
      const balance = await this.lockBalance(db, data.userId, data.serviceId);
      if (await this.alreadyGranted(db, balance.id, data.orderId)) return balance;

      // Only what is left of the period expires. Purchased credits stay, and a
      // negative period bucket (a refunded grant that was already spent) is a
      // debt the new grant settles.
      const expired = Math.max(balance.periodBalance ?? 0, 0);
      if (expired > 0) {
        const lastGrant = await db.creditUsage.findFirst({
          where: {
            creditBalanceId: balance.id,
            type: 'grant',
            metadata: { path: ['bucket'], equals: 'period' },
          },
          orderBy: { createdAt: 'desc' },
        });
        await db.creditUsage.create({
          data: {
            creditBalanceId: balance.id,
            userId: data.userId,
            amount: -expired,
            type: 'reset',
            description: `Period reset: ${expired} credits expired`,
            orderId: data.orderId ?? null,
            metadata: { expiredGrantId: lastGrant?.id ?? null },
          },
        });
      }

      const change = data.newBalance - expired;
      const updated = await db.creditBalance.update({
        where: { id: balance.id },
        data: {
          balance: { increment: change },
          periodBalance: { increment: change },
          // Expired credits leave `totalGranted`, so balance = granted - used.
          totalGranted: { increment: change },
          resetsAt: data.resetsAt,
        },
      });

      await this.recordGrant(db, balance, {
        amount: data.newBalance,
        bucket: 'period',
        description: `Period reset: ${data.newBalance} credits granted`,
        orderId: data.orderId,
        source: data.source,
      });

      this.logger.log(
        `Reset credits for user ${data.userId} (service: ${data.serviceId ?? 'global'}): period balance ${data.newBalance}`,
      );

      return updated;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
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
      const balance = await this.lockBalance(tx, data.userId, data.serviceId);

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
        // Purchased credits first; only the rest comes out of the period.
        const period = balance.periodBalance ?? 0;
        const purchased = Math.max(balance.balance - period, 0);
        const fromPeriod = Math.max(Math.abs(data.amount) - purchased, 0);
        if (fromPeriod > 0) updateData.periodBalance = { decrement: fromPeriod };
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
   * Take back credits that an order paid for, because that order was refunded.
   *
   * This replaces a method called `refund`, which incremented the balance. The
   * name was read as "refund the credits to the user" while its only caller was
   * the order-refund path, where the money is going back to the customer and
   * the credits have to go the other way. A customer who bought 100 credits and
   * asked for their money back was left with 200.
   *
   * `totalGranted` comes down with the balance so that
   * `balance = totalGranted - totalUsed` still holds; incrementing it, as the
   * old method did, corrupted that identity as well.
   *
   * The balance is allowed to go negative when the credits have already been
   * spent. That is the true state — the customer consumed value they no longer
   * paid for — and `consume` refuses to spend from it, so the debt has to be
   * settled by a grant before they can continue.
   */
  async revokeGrant(
    data: {
      userId: string;
      serviceId?: string;
      amount: number;
      orderId: string;
      reason?: string;
      /** The ledger row being revoked; a grant is revoked once. */
      grant?: { id: string; metadata?: unknown };
    },
    tx?: Prisma.TransactionClient,
  ): Promise<CreditBalance> {
    const run = async (db: Prisma.TransactionClient) => {
      const balance = await this.lockBalance(db, data.userId, data.serviceId);
      const { grant } = data;
      // Grants made before the buckets have no metadata and are purchased.
      const meta = (grant?.metadata ?? {}) as Record<string, any>;
      let expired = 0;
      if (grant) {
        const revoked = await db.creditUsage.findFirst({
          where: {
            creditBalanceId: balance.id,
            type: 'purchase_reversal',
            metadata: { path: ['grantId'], equals: grant.id },
          },
        });
        if (revoked) return balance;
        // What already expired with its period is gone: taking it again would
        // come out of a later period or a purchase.
        const resets = await db.creditUsage.findMany({
          where: {
            creditBalanceId: balance.id,
            type: 'reset',
            metadata: { path: ['expiredGrantId'], equals: grant.id },
          },
        });
        expired = Math.min(
          resets.reduce((sum, r) => sum - r.amount, 0),
          data.amount,
        );
      }
      const take = data.amount - expired;

      const updated = await db.creditBalance.update({
        where: { id: balance.id },
        data: {
          balance: { decrement: take },
          totalGranted: { decrement: take },
          ...(meta.bucket === 'period' ? { periodBalance: { decrement: take } } : {}),
        },
      });

      await db.creditUsage.create({
        data: {
          creditBalanceId: balance.id,
          userId: data.userId,
          // Negative, like `reset`: the ledger reads as a running total, and a
          // positive number here would sum as if credits had been added.
          amount: take === 0 ? 0 : -take,
          type: 'purchase_reversal',
          description: data.reason ?? `Revoked: order ${data.orderId} refunded`,
          orderId: data.orderId,
          metadata: grant ? { grantId: grant.id } : {},
        },
      });

      if (grant) {
        await this.outbox.emit(
          CREDITS_REVOKED,
          creditRevokedPayload({
            grant: { id: grant.id, amount: data.amount, metadata: grant.metadata },
            userId: data.userId,
            orderId: data.orderId,
          }),
          { serviceId: balance.serviceId, tx: db },
        );
      }

      if (updated.balance < 0) {
        this.logger.warn(
          `Revoked ${take} credits from user ${data.userId} for refunded order ${data.orderId}: balance is now ${updated.balance} (they had already been spent)`,
        );
      } else {
        this.logger.log(
          `Revoked ${take} credits from user ${data.userId} for refunded order ${data.orderId}`,
        );
      }

      return updated;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * List all balances with filters (admin)
   */
  async listBalances(params: {
    userId?: string;
    serviceId?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<{
    items: CreditBalance[];
    total: number;
    page: number;
    limit: number;
    pages: number;
  }> {
    const page = params.page || 1;
    const limit = Math.min(params.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.userId) where.userId = params.userId;
    if (params.serviceId) where.serviceId = params.serviceId;

    const [items, total] = await Promise.all([
      this.prisma.creditBalance.findMany({
        where,
        orderBy: resolveOrderBy(
          CREDIT_BALANCE_SORT,
          { updatedAt: 'desc' },
          params.sortBy,
          params.sortOrder,
        ),
        skip,
        take: limit,
        include: { service: true },
      }),
      this.prisma.creditBalance.count({ where }),
    ]);

    // `pages` was missing, so the admin had no way to know the list was cut at
    // twenty and rendered the first page as if it were the whole ledger.
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
