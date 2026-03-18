import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  AffiliateResponseDto,
  ReferralResponseDto,
  CommissionResponseDto,
  PayoutResponseDto,
  AffiliateStatsDto,
} from '../common/dto/affiliate.dto';
import { ReferralLevelsService } from './referral-levels.service';

@Injectable()
export class AffiliatesService {
  private readonly logger = new Logger(AffiliatesService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly referralLevelsService: ReferralLevelsService,
  ) {
    this.baseUrl = this.configService.get<string>('FRONTEND_URL') || 'https://app.inite.ai';
  }

  private generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async createOrGetAffiliate(
    userId: string,
    referralCode?: string,
    serviceId?: string,
  ): Promise<AffiliateResponseDto> {
    // Check if affiliate already exists for this user+service
    let affiliate = await this.prisma.affiliate.findFirst({
      where: { userId, serviceId: serviceId || null },
    });

    if (affiliate) {
      return this.mapAffiliateToDto(affiliate);
    }

    let code = referralCode;
    if (!code) {
      code = this.generateReferralCode();
      while (await this.prisma.affiliate.findUnique({ where: { referralCode: code } })) {
        code = this.generateReferralCode();
      }
    } else {
      const existing = await this.prisma.affiliate.findUnique({
        where: { referralCode: code },
      });
      if (existing) {
        throw new BadRequestException(`Referral code already taken: ${code}`);
      }
    }

    // If there's a parent referral (this user was referred), link the parent
    let parentAffiliateId: string | undefined;
    if (serviceId) {
      const referral = await this.prisma.referral.findFirst({
        where: { referredUserId: userId, serviceId },
        include: { affiliate: true },
      });
      if (referral) {
        parentAffiliateId = referral.affiliateId;
      }
    }

    affiliate = await this.prisma.affiliate.create({
      data: {
        userId,
        serviceId,
        parentAffiliateId,
        referralCode: code,
        status: 'active',
        commissionRate: 0.5,
      },
    });

    this.logger.log(`Created affiliate account for user ${userId} with code ${code}`);

    return this.mapAffiliateToDto(affiliate);
  }

  async getAffiliateByUserId(userId: string, serviceId?: string): Promise<AffiliateResponseDto> {
    const where: any = { userId };
    if (serviceId) {
      where.serviceId = serviceId;
    } else {
      where.serviceId = null;
    }

    const affiliate = await this.prisma.affiliate.findFirst({ where });

    if (!affiliate) {
      throw new NotFoundException(`Affiliate not found for user: ${userId}`);
    }

    return this.mapAffiliateToDto(affiliate);
  }

  async getAffiliateByCode(referralCode: string): Promise<AffiliateResponseDto | null> {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { referralCode },
    });

    if (!affiliate) {
      return null;
    }

    return this.mapAffiliateToDto(affiliate);
  }

  async trackReferral(
    affiliateId: string,
    referredUserId: string,
    referralCode: string,
    serviceId?: string,
  ): Promise<ReferralResponseDto> {
    // Check if referral already exists for this user+service
    const existing = await this.prisma.referral.findFirst({
      where: {
        referredUserId,
        serviceId: serviceId || null,
      },
    });

    if (existing) {
      return this.mapReferralToDto(existing);
    }

    const referral = await this.prisma.referral.create({
      data: {
        affiliateId,
        referredUserId,
        referralCode,
        serviceId,
        firstOrderPaid: false,
      },
    });

    this.logger.log(`Tracked referral: ${referredUserId} -> affiliate ${affiliateId}`);

    return this.mapReferralToDto(referral);
  }

  async getReferrals(affiliateId: string): Promise<ReferralResponseDto[]> {
    const referrals = await this.prisma.referral.findMany({
      where: { affiliateId },
      orderBy: { createdAt: 'desc' },
    });

    return referrals.map((r) => this.mapReferralToDto(r));
  }

  async getCommissions(
    affiliateId: string,
    status?: string,
  ): Promise<CommissionResponseDto[]> {
    const where: any = { affiliateId };
    if (status) {
      where.status = status;
    }

    const commissions = await this.prisma.affiliateCommission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return commissions.map((c) => this.mapCommissionToDto(c));
  }

  async getPayouts(affiliateId: string): Promise<PayoutResponseDto[]> {
    const payouts = await this.prisma.affiliatePayout.findMany({
      where: { affiliateId },
      orderBy: { periodEnd: 'desc' },
    });

    return payouts.map((p) => this.mapPayoutToDto(p));
  }

  async getAffiliateStats(affiliateId: string): Promise<AffiliateStatsDto> {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      include: {
        referrals: true,
        commissions: true,
        payouts: {
          where: { status: 'pending' },
          orderBy: { periodEnd: 'desc' },
          take: 1,
        },
      },
    });

    if (!affiliate) {
      throw new NotFoundException(`Affiliate not found: ${affiliateId}`);
    }

    const pendingCommissions = affiliate.commissions
      .filter((c) => c.status === 'pending' || c.status === 'earned')
      .reduce((sum, c) => sum + Number(c.amount), 0);

    return {
      totalReferrals: affiliate.referrals.length,
      totalCommissions: affiliate.totalEarned.toString(),
      pendingCommissions: pendingCommissions.toString(),
      paidCommissions: affiliate.totalPaid.toString(),
      upcomingPayout: affiliate.payouts[0]
        ? this.mapPayoutToDto(affiliate.payouts[0])
        : undefined,
    };
  }

  /**
   * Get affiliate tree (downline) with nested children
   */
  async getAffiliateTree(affiliateId: string, maxDepth = 10) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      include: {
        childAffiliates: {
          include: {
            _count: { select: { referrals: true } },
          },
        },
        _count: { select: { referrals: true } },
      },
    });

    if (!affiliate) {
      throw new NotFoundException(`Affiliate not found: ${affiliateId}`);
    }

    const buildTree = async (aff: any, depth: number): Promise<any> => {
      if (depth >= maxDepth) return { ...this.mapAffiliateToDto(aff), children: [] };

      const children = await this.prisma.affiliate.findMany({
        where: { parentAffiliateId: aff.id },
        include: { _count: { select: { referrals: true } } },
      });

      const childTrees = await Promise.all(
        children.map((child) => buildTree(child, depth + 1)),
      );

      return {
        ...this.mapAffiliateToDto(aff),
        totalReferrals: aff._count?.referrals || 0,
        children: childTrees,
      };
    };

    return buildTree(affiliate, 0);
  }

  /**
   * Process multi-level commissions when an order is paid
   */
  async processMultiLevelCommissions(
    orderId: string,
    userId: string,
    amount: number,
    currency: string,
    serviceId?: string,
    tx?: any,
  ): Promise<void> {
    const db = tx || this.prisma;

    // Find referral for this user + service
    const referral = await db.referral.findFirst({
      where: {
        referredUserId: userId,
        serviceId: serviceId || null,
      },
      include: { affiliate: true },
    });

    if (!referral) {
      return; // No referral, no commission
    }

    // Only pay commission on first order
    if (referral.firstOrderPaid) {
      this.logger.debug(
        `Referral ${referral.id} already has first order paid, skipping commission`,
      );
      return;
    }

    // Walk up the affiliate chain
    let currentAffiliate = referral.affiliate;
    let currentLevel = 1;

    while (currentAffiliate) {
      if (currentAffiliate.status !== 'active') {
        this.logger.debug(
          `Affiliate ${currentAffiliate.id} is not active, skipping level ${currentLevel}`,
        );
        currentAffiliate = currentAffiliate.parentAffiliateId
          ? await db.affiliate.findUnique({ where: { id: currentAffiliate.parentAffiliateId } })
          : null;
        currentLevel++;
        continue;
      }

      // Get commission rate for this level
      let commissionRate: number | null = null;

      if (serviceId) {
        commissionRate = await this.referralLevelsService.getCommissionRateForLevel(
          serviceId,
          currentLevel,
        );
      }

      // Fall back to affiliate's own commission rate for level 1 if no service levels configured
      if (commissionRate === null) {
        if (currentLevel === 1) {
          commissionRate = Number(currentAffiliate.commissionRate);
        } else {
          // No rate configured for this level, stop walking up
          break;
        }
      }

      const commissionAmount = amount * commissionRate;

      if (commissionAmount > 0) {
        await db.affiliateCommission.create({
          data: {
            affiliateId: currentAffiliate.id,
            referralId: referral.id,
            orderId,
            level: currentLevel,
            amount: commissionAmount,
            commissionRate,
            currency,
            status: 'earned',
            earnedAt: new Date(),
          },
        });

        await db.affiliate.update({
          where: { id: currentAffiliate.id },
          data: {
            totalEarned: { increment: commissionAmount },
          },
        });

        this.logger.log(
          `Created L${currentLevel} commission for affiliate ${currentAffiliate.id}, order ${orderId}: ${commissionAmount} ${currency}`,
        );
      }

      // Walk up to parent
      if (currentAffiliate.parentAffiliateId) {
        currentAffiliate = await db.affiliate.findUnique({
          where: { id: currentAffiliate.parentAffiliateId },
        });
      } else {
        currentAffiliate = null;
      }
      currentLevel++;
    }

    // Update referral
    await db.referral.update({
      where: { id: referral.id },
      data: {
        firstOrderPaid: true,
        firstOrderId: orderId,
      },
    });
  }

  private mapAffiliateToDto(affiliate: any): AffiliateResponseDto {
    return {
      id: affiliate.id,
      userId: affiliate.userId,
      referralCode: affiliate.referralCode,
      status: affiliate.status,
      commissionRate: affiliate.commissionRate.toString(),
      totalEarned: affiliate.totalEarned.toString(),
      totalPaid: affiliate.totalPaid.toString(),
      referralUrl: `${this.baseUrl}?ref=${affiliate.referralCode}`,
      createdAt: affiliate.createdAt,
    };
  }

  private mapReferralToDto(referral: any): ReferralResponseDto {
    return {
      id: referral.id,
      referredUserId: referral.referredUserId,
      firstOrderPaid: referral.firstOrderPaid,
      firstOrderId: referral.firstOrderId || undefined,
      createdAt: referral.createdAt,
    };
  }

  private mapCommissionToDto(commission: any): CommissionResponseDto {
    return {
      id: commission.id,
      orderId: commission.orderId,
      amount: commission.amount.toString(),
      commissionRate: commission.commissionRate.toString(),
      currency: commission.currency,
      status: commission.status,
      earnedAt: commission.earnedAt || undefined,
      createdAt: commission.createdAt,
    };
  }

  private mapPayoutToDto(payout: any): PayoutResponseDto {
    return {
      id: payout.id,
      periodStart: payout.periodStart,
      periodEnd: payout.periodEnd,
      totalAmount: payout.totalAmount.toString(),
      currency: payout.currency,
      status: payout.status,
      payoutDate: payout.payoutDate || undefined,
      createdAt: payout.createdAt,
    };
  }
}
