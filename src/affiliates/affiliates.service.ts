import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
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

    // Circular referral chain prevention (H5): walk parent chain and check for cycles
    if (parentAffiliateId) {
      let currentParentId: string | null = parentAffiliateId;
      const visited = new Set<string>();
      while (currentParentId) {
        if (visited.has(currentParentId)) {
          // Already visited this node — break to avoid infinite loop
          parentAffiliateId = undefined;
          break;
        }
        visited.add(currentParentId);
        const parentAff: any = await this.prisma.affiliate.findUnique({
          where: { id: currentParentId },
        });
        if (!parentAff) break;
        if (parentAff.userId === userId) {
          // The new affiliate's userId already appears in the parent chain — break chain
          this.logger.warn(
            `Circular referral detected: userId ${userId} already in parent chain. Breaking link.`,
          );
          parentAffiliateId = undefined;
          break;
        }
        currentParentId = parentAff.parentAffiliateId;
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
    // Self-referral prevention (C3)
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
    });
    if (affiliate && affiliate.userId === referredUserId) {
      throw new BadRequestException('Cannot refer yourself');
    }

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
   * Check if affiliate qualifies for a commission level
   * based on qualificationCriteria from ReferralLevel
   */
  private async checkQualification(
    affiliate: any,
    criteria: any,
    serviceId: string | undefined,
    db: any,
  ): Promise<boolean> {
    if (!criteria || Object.keys(criteria).length === 0) {
      return true; // No criteria = always qualified
    }

    // minDirectReferrals — minimum total direct referrals
    if (criteria.minDirectReferrals) {
      const count = await db.referral.count({
        where: { affiliateId: affiliate.id },
      });
      if (count < criteria.minDirectReferrals) {
        this.logger.debug(
          `Affiliate ${affiliate.id} failed minDirectReferrals: ${count} < ${criteria.minDirectReferrals}`,
        );
        return false;
      }
    }

    // minActiveReferrals — minimum referrals who have paid first order
    if (criteria.minActiveReferrals) {
      const count = await db.referral.count({
        where: { affiliateId: affiliate.id, firstOrderPaid: true },
      });
      if (count < criteria.minActiveReferrals) {
        this.logger.debug(
          `Affiliate ${affiliate.id} failed minActiveReferrals: ${count} < ${criteria.minActiveReferrals}`,
        );
        return false;
      }
    }

    // minPersonalOrders — affiliate must have placed N orders themselves
    if (criteria.minPersonalOrders) {
      const count = await db.order.count({
        where: { userId: affiliate.userId, status: 'paid' },
      });
      if (count < criteria.minPersonalOrders) {
        this.logger.debug(
          `Affiliate ${affiliate.id} failed minPersonalOrders: ${count} < ${criteria.minPersonalOrders}`,
        );
        return false;
      }
    }

    // personalPurchaseRequired — affiliate must have at least one active subscription or paid order
    if (criteria.personalPurchaseRequired) {
      const hasOrder = await db.order.findFirst({
        where: { userId: affiliate.userId, status: 'paid' },
      });
      const hasSub = await db.subscription.findFirst({
        where: {
          userId: affiliate.userId,
          status: { in: ['active', 'trialing'] },
        },
      });
      if (!hasOrder && !hasSub) {
        this.logger.debug(
          `Affiliate ${affiliate.id} failed personalPurchaseRequired`,
        );
        return false;
      }
    }

    // minMonthlyVolume — minimum monthly sales volume from downline
    if (criteria.minMonthlyVolume) {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      const volume = await db.affiliateCommission.aggregate({
        where: {
          affiliateId: affiliate.id,
          status: { in: ['earned', 'paid'] },
          earnedAt: { gte: monthAgo },
        },
        _sum: { amount: true },
      });
      const total = Number(volume._sum.amount || 0);
      if (total < criteria.minMonthlyVolume) {
        this.logger.debug(
          `Affiliate ${affiliate.id} failed minMonthlyVolume: ${total} < ${criteria.minMonthlyVolume}`,
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Process multi-level commissions when an order is paid.
   *
   * Chain: buyer → L1 (direct referrer) → L2 (parent) → ... → L7 (root)
   *
   * Key behavior on disqualification/inactivity:
   * - If an affiliate is inactive or doesn't meet qualificationCriteria,
   *   they are SKIPPED and the level does NOT increment.
   * - This means the next qualified affiliate UP the chain gets the
   *   commission at the current level rate ("shift upward").
   *
   * Example with $20 product:
   *   Chain: You → Me → Wife → Friend
   *   If Me is disqualified:
   *     Friend buys → Wife gets L1 (15% = $3), You gets L2 (1% = $0.20)
   *     Me gets nothing, levels compress.
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

    const referral = await db.referral.findFirst({
      where: {
        referredUserId: userId,
        serviceId: serviceId || null,
      },
      include: { affiliate: true },
    });

    if (!referral) {
      return;
    }

    // Atomic check-and-set for firstOrderPaid to prevent double commission (H8)
    const updateResult = await db.referral.updateMany({
      where: {
        id: referral.id,
        firstOrderPaid: false,
      },
      data: {
        firstOrderPaid: true,
        firstOrderId: orderId,
      },
    });

    if (updateResult.count === 0) {
      this.logger.debug(
        `Referral ${referral.id} already has first order paid, skipping commission`,
      );
      return;
    }

    // Pre-load all referral levels for this service (sorted by level)
    let serviceLevels: any[] = [];
    if (serviceId) {
      serviceLevels = await db.referralLevel.findMany({
        where: { serviceId, isActive: true },
        orderBy: { level: 'asc' },
      });
    }

    const maxConfiguredLevel = serviceLevels.length > 0
      ? Math.max(...serviceLevels.map((l: any) => l.level))
      : 1;

    // Walk up the affiliate chain
    let currentAffiliate = referral.affiliate;
    let currentLevel = 1; // commission level (only increments for qualified affiliates)

    while (currentAffiliate && currentLevel <= maxConfiguredLevel) {
      // Get the referral level config for currentLevel
      const levelConfig = serviceLevels.find((l: any) => l.level === currentLevel);

      // Check if affiliate is active
      if (currentAffiliate.status !== 'active') {
        this.logger.debug(
          `Affiliate ${currentAffiliate.id} is inactive, shift upward (level stays ${currentLevel})`,
        );
        // Shift upward: walk to parent WITHOUT incrementing level
        currentAffiliate = currentAffiliate.parentAffiliateId
          ? await db.affiliate.findUnique({ where: { id: currentAffiliate.parentAffiliateId } })
          : null;
        continue; // level stays the same
      }

      // Check qualification criteria
      const criteria = levelConfig?.qualificationCriteria || {};
      const isQualified = await this.checkQualification(
        currentAffiliate,
        criteria,
        serviceId,
        db,
      );

      if (!isQualified) {
        this.logger.debug(
          `Affiliate ${currentAffiliate.id} not qualified for level ${currentLevel}, shift upward`,
        );
        // Shift upward: walk to parent WITHOUT incrementing level
        currentAffiliate = currentAffiliate.parentAffiliateId
          ? await db.affiliate.findUnique({ where: { id: currentAffiliate.parentAffiliateId } })
          : null;
        continue; // level stays the same
      }

      // Get commission rate
      let commissionRate: number | null = null;

      if (levelConfig) {
        commissionRate = Number(levelConfig.commissionRate);
      } else if (currentLevel === 1) {
        // Fallback for level 1 if no service levels configured
        commissionRate = Number(currentAffiliate.commissionRate);
      } else {
        break; // No rate for this level
      }

      const commissionAmount = new Decimal(amount).mul(new Decimal(commissionRate)).toDecimalPlaces(4).toNumber();

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

      // Move to parent AND increment level (affiliate was qualified)
      if (currentAffiliate.parentAffiliateId) {
        currentAffiliate = await db.affiliate.findUnique({
          where: { id: currentAffiliate.parentAffiliateId },
        });
      } else {
        currentAffiliate = null;
      }
      currentLevel++;
    }

    // Note: firstOrderPaid and firstOrderId already set atomically above (H8)
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
