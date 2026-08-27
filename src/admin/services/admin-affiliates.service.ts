import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { paginate } from '../../common/helpers/paginate';
import { resolveOrderBy, SortWhitelist } from '../../common/helpers/sort';

export const AFFILIATE_SORT: SortWhitelist = {
  createdAt: ['createdAt'],
  referralCode: ['referralCode'],
  status: ['status'],
  totalEarned: ['totalEarned'],
  totalPaid: ['totalPaid'],
  referrals: ['referrals', '_count'],
};

/**
 * A payout run is worked by size and by age, not by insertion order: the
 * operator clearing tonight's queue wants the largest amounts checked first.
 */
export const PAYOUT_SORT: SortWhitelist = {
  createdAt: ['createdAt'],
  totalAmount: ['totalAmount'],
  status: ['status'],
  periodStart: ['periodStart'],
  affiliate: ['affiliate', 'referralCode'],
};

@Injectable()
export class AdminAffiliatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAffiliates(params: {
    status?: string;
    serviceId?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }) {
    const { status, serviceId, page, limit, sortBy, sortOrder } = params;
    const where: any = {};
    if (status) where.status = status;
    if (serviceId) where.serviceId = serviceId;

    return paginate(this.prisma.affiliate, where, {
      page,
      limit,
      orderBy: resolveOrderBy(AFFILIATE_SORT, { createdAt: 'desc' }, sortBy, sortOrder),
      include: {
        _count: { select: { referrals: true, commissions: true } },
      },
    });
  }

  async updateAffiliate(id: string, data: { status?: string; commissionRate?: number }) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id },
    });
    if (!affiliate) throw new NotFoundException(`Affiliate not found: ${id}`);

    // Validate commission rate bounds (C5)
    if (data.commissionRate !== undefined && (data.commissionRate < 0 || data.commissionRate > 1)) {
      throw new BadRequestException('commissionRate must be between 0 and 1 (inclusive)');
    }

    return this.prisma.affiliate.update({
      where: { id },
      data: data as any,
    });
  }

  async getPayouts(params: {
    status?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }) {
    const { status, page, limit, sortBy, sortOrder } = params;
    const where: any = {};
    if (status) where.status = status;

    return paginate(this.prisma.affiliatePayout, where, {
      page,
      limit,
      orderBy: resolveOrderBy(PAYOUT_SORT, { createdAt: 'desc' }, sortBy, sortOrder),
      include: { affiliate: true },
    });
  }

  async processPayout(id: string) {
    const payout = await this.prisma.affiliatePayout.findUnique({
      where: { id },
    });
    if (!payout) throw new NotFoundException(`Payout not found: ${id}`);
    if (payout.status !== 'pending') {
      throw new BadRequestException(`Payout is not in pending status`);
    }

    return this.prisma.affiliatePayout.update({
      where: { id },
      data: { status: 'paid', processedAt: new Date() },
    });
  }

  /**
   * Apply one action to a selection of payouts.
   *
   * Not atomic, and deliberately not presented as such: each payout is its own
   * transaction and the response carries a per-id verdict, so a payout that is
   * already paid or already failed stops itself without taking the other
   * nineteen down with it. The caller shows the operator exactly which ones
   * went through and why the rest did not.
   *
   * Sequential on purpose — `failPayout` reverses an affiliate's balance, and
   * running a batch in parallel would have several of those contending for the
   * same affiliate row.
   */
  async bulkPayoutAction(params: { ids: string[]; action: 'process' | 'fail'; reason?: string }) {
    const { ids, action, reason } = params;
    const results: Array<{ id: string; ok: boolean; status?: string; error?: string }> = [];

    for (const id of ids) {
      try {
        const payout =
          action === 'process' ? await this.processPayout(id) : await this.failPayout(id, reason);
        results.push({ id, ok: true, status: payout.status });
      } catch (e: any) {
        results.push({ id, ok: false, error: e?.message ?? 'Failed' });
      }
    }

    return {
      requested: ids.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  async failPayout(id: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.affiliatePayout.findUnique({ where: { id } });
      if (!payout) throw new NotFoundException(`Payout not found: ${id}`);

      // Idempotent: a payout already marked failed has already been reversed.
      if (payout.status === 'failed') {
        return payout;
      }
      // Money for a 'paid' payout has already left — reversing the balance here
      // would silently credit the affiliate twice. Refunds of sent money are a
      // separate, manual concern.
      if (payout.status === 'paid') {
        throw new BadRequestException('Cannot fail a payout that has already been paid out');
      }

      // Release the commissions this payout reserved so they become withdrawable
      // again, and reverse the affiliate's paid total. Without this, a failed
      // payout permanently strands the balance (available never recovers).
      await tx.affiliateCommission.updateMany({
        where: { payoutId: id },
        data: { payoutId: null, status: 'earned' },
      });

      await tx.affiliate.update({
        where: { id: payout.affiliateId },
        data: { totalPaid: { decrement: payout.totalAmount } },
      });

      return tx.affiliatePayout.update({
        where: { id },
        data: {
          status: 'failed',
          failureReason: reason || 'Marked as failed by admin',
          processedAt: new Date(),
        },
      });
    });
  }
}
