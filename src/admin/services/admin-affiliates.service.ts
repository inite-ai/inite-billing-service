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
    const payout = await this.prisma.affiliatePayout.findUnique({
      where: { id },
    });
    if (!payout) throw new NotFoundException(`Payout not found: ${id}`);

    return this.prisma.affiliatePayout.update({
      where: { id },
      data: { status: 'failed', failureReason: reason || 'Marked as failed by admin' },
    });
  }
}
