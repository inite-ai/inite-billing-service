import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { CreditBalance, CreditUsage } from '@prisma/client';

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get or create balance for user+service
   */
  async getBalance(userId: string, serviceId?: string): Promise<CreditBalance> {
    const existing = await this.prisma.creditBalance.findUnique({
      where: {
        userId_serviceId: { userId, serviceId: (serviceId ?? null) as any },
      },
    });

    if (existing) return existing;

    return this.prisma.creditBalance.create({
      data: {
        userId,
        serviceId: (serviceId ?? null) as any,
        balance: 0,
        totalGranted: 0,
        totalUsed: 0,
      },
    });
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
      // Find or create CreditBalance
      let balance = await tx.creditBalance.findUnique({
        where: {
          userId_serviceId: {
            userId: data.userId,
            serviceId: (data.serviceId ?? null) as any,
          },
        },
      });

      if (!balance) {
        balance = await tx.creditBalance.create({
          data: {
            userId: data.userId,
            serviceId: (data.serviceId ?? null) as any,
            balance: 0,
            totalGranted: 0,
            totalUsed: 0,
          },
        });
      }

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
   * Consume credits (called by external services via API)
   */
  async consume(data: {
    userId: string;
    serviceId?: string;
    amount: number;
    description?: string;
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; remainingBalance: number; error?: string }> {
    return this.prisma.$transaction(async (tx) => {
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

      if (balance.balance < data.amount) {
        return {
          success: false,
          remainingBalance: balance.balance,
          error: 'Insufficient credits',
        };
      }

      // Decrement balance, increment totalUsed
      const updated = await tx.creditBalance.update({
        where: { id: balance.id },
        data: {
          balance: { decrement: data.amount },
          totalUsed: { increment: data.amount },
        },
      });

      // Create CreditUsage record
      await tx.creditUsage.create({
        data: {
          creditBalanceId: balance.id,
          userId: data.userId,
          amount: -data.amount,
          type: 'consume',
          description: data.description ?? 'Credits consumed',
          metadata: data.metadata ?? {},
        },
      });

      this.logger.log(
        `Consumed ${data.amount} credits from user ${data.userId} (service: ${data.serviceId ?? 'global'})`,
      );

      return {
        success: true,
        remainingBalance: updated.balance,
      };
    });
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
      // Find or create CreditBalance
      let balance = await tx.creditBalance.findUnique({
        where: {
          userId_serviceId: {
            userId: data.userId,
            serviceId: (data.serviceId ?? null) as any,
          },
        },
      });

      if (!balance) {
        balance = await tx.creditBalance.create({
          data: {
            userId: data.userId,
            serviceId: (data.serviceId ?? null) as any,
            balance: 0,
            totalGranted: 0,
            totalUsed: 0,
          },
        });
      }

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
      let balance = await tx.creditBalance.findUnique({
        where: {
          userId_serviceId: {
            userId: data.userId,
            serviceId: (data.serviceId ?? null) as any,
          },
        },
      });

      if (!balance) {
        balance = await tx.creditBalance.create({
          data: {
            userId: data.userId,
            serviceId: (data.serviceId ?? null) as any,
            balance: 0,
            totalGranted: 0,
            totalUsed: 0,
          },
        });
      }

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
      let balance = await tx.creditBalance.findUnique({
        where: {
          userId_serviceId: {
            userId: data.userId,
            serviceId: (data.serviceId ?? null) as any,
          },
        },
      });

      if (!balance) {
        balance = await tx.creditBalance.create({
          data: {
            userId: data.userId,
            serviceId: (data.serviceId ?? null) as any,
            balance: 0,
            totalGranted: 0,
            totalUsed: 0,
          },
        });
      }

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
