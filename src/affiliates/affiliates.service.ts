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
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AffiliatesService {
  private readonly logger = new Logger(AffiliatesService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('FRONTEND_URL') || 'https://app.inite.ai';
  }

  /**
   * Generate unique referral code
   */
  private generateReferralCode(): string {
    // Generate a short, unique code (8 characters)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Create or get affiliate account for user
   */
  async createOrGetAffiliate(
    userId: string,
    referralCode?: string,
  ): Promise<AffiliateResponseDto> {
    // Check if affiliate already exists
    let affiliate = await this.prisma.affiliate.findUnique({
      where: { userId },
    });

    if (affiliate) {
      return this.mapAffiliateToDto(affiliate);
    }

    // Generate referral code if not provided
    let code = referralCode;
    if (!code) {
      code = this.generateReferralCode();
      // Ensure uniqueness
      while (await this.prisma.affiliate.findUnique({ where: { referralCode: code } })) {
        code = this.generateReferralCode();
      }
    } else {
      // Check if code is already taken
      const existing = await this.prisma.affiliate.findUnique({
        where: { referralCode: code },
      });
      if (existing) {
        throw new BadRequestException(`Referral code already taken: ${code}`);
      }
    }

    // Create affiliate
    affiliate = await this.prisma.affiliate.create({
      data: {
        userId,
        referralCode: code,
        status: 'active',
        commissionRate: 0.5, // 50% default
      },
    });

    this.logger.log(`Created affiliate account for user ${userId} with code ${code}`);

    return this.mapAffiliateToDto(affiliate);
  }

  /**
   * Get affiliate by user ID
   */
  async getAffiliateByUserId(userId: string): Promise<AffiliateResponseDto> {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { userId },
    });

    if (!affiliate) {
      throw new NotFoundException(`Affiliate not found for user: ${userId}`);
    }

    return this.mapAffiliateToDto(affiliate);
  }

  /**
   * Get affiliate by referral code
   */
  async getAffiliateByCode(referralCode: string): Promise<AffiliateResponseDto | null> {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { referralCode },
    });

    if (!affiliate) {
      return null;
    }

    return this.mapAffiliateToDto(affiliate);
  }

  /**
   * Track referral (when user signs up with referral code)
   */
  async trackReferral(
    affiliateId: string,
    referredUserId: string,
    referralCode: string,
  ): Promise<ReferralResponseDto> {
    // Check if referral already exists
    const existing = await this.prisma.referral.findUnique({
      where: { referredUserId },
    });

    if (existing) {
      return this.mapReferralToDto(existing);
    }

    // Create referral
    const referral = await this.prisma.referral.create({
      data: {
        affiliateId,
        referredUserId,
        referralCode,
        firstOrderPaid: false,
      },
    });

    this.logger.log(`Tracked referral: ${referredUserId} -> affiliate ${affiliateId}`);

    return this.mapReferralToDto(referral);
  }

  /**
   * Get referrals for affiliate
   */
  async getReferrals(affiliateId: string): Promise<ReferralResponseDto[]> {
    const referrals = await this.prisma.referral.findMany({
      where: { affiliateId },
      orderBy: { createdAt: 'desc' },
    });

    return referrals.map((r) => this.mapReferralToDto(r));
  }

  /**
   * Get commissions for affiliate
   */
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

  /**
   * Get payouts for affiliate
   */
  async getPayouts(affiliateId: string): Promise<PayoutResponseDto[]> {
    const payouts = await this.prisma.affiliatePayout.findMany({
      where: { affiliateId },
      orderBy: { periodEnd: 'desc' },
    });

    return payouts.map((p) => this.mapPayoutToDto(p));
  }

  /**
   * Get affiliate stats
   */
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
