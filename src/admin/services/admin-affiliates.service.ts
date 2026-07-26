import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class AdminAffiliatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAffiliates(params: {
    status?: string;
    serviceId?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, serviceId, page, limit } = params;
    const where: any = {};
    if (status) where.status = status;
    if (serviceId) where.serviceId = serviceId;

    return paginate(this.prisma.affiliate, where, {
      page,
      limit,
      orderBy: { createdAt: 'desc' },
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

  async getPayouts(params: { status?: string; page?: number; limit?: number }) {
    const { status, page, limit } = params;
    const where: any = {};
    if (status) where.status = status;

    return paginate(this.prisma.affiliatePayout, where, {
      page,
      limit,
      orderBy: { createdAt: 'desc' },
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
