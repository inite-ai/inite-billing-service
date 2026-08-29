import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';

@Injectable()
export class PromoCodesService {
  private readonly logger = new Logger(PromoCodesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Validation ───────────────────────────────────────────

  async validatePromoCode(
    code: string,
    priceId: string,
    userId: string,
  ): Promise<{
    isValid: boolean;
    error?: string;
    errorCode?: string;
    promoCode?: any;
    discountAmount?: number;
    finalAmount?: number;
    minPurchaseAmount?: number;
    originalAmount?: number;
  }> {
    // Find the promo code
    const promoCode = await this.prisma.promoCode.findUnique({
      where: { code },
    });

    if (!promoCode) {
      return { isValid: false, error: 'not_found', errorCode: 'not_found' };
    }

    if (!promoCode.isActive) {
      return { isValid: false, error: 'inactive', errorCode: 'inactive' };
    }

    // Check date range
    const now = new Date();
    if (now < promoCode.validFrom) {
      return { isValid: false, error: 'not_yet_valid', errorCode: 'not_yet_valid' };
    }
    if (promoCode.validUntil && now > promoCode.validUntil) {
      return { isValid: false, error: 'expired', errorCode: 'expired' };
    }

    // Check global usage limit
    if (
      promoCode.maxUsageCount !== null &&
      promoCode.currentUsageCount >= promoCode.maxUsageCount
    ) {
      return { isValid: false, error: 'usage_limit_reached', errorCode: 'usage_limit_reached' };
    }

    // Check per-user usage limit
    if (promoCode.maxUsagePerUser !== null) {
      const userUsageCount = await this.prisma.promoCodeUsage.count({
        where: {
          promoCodeId: promoCode.id,
          userId,
        },
      });
      if (userUsageCount >= promoCode.maxUsagePerUser) {
        return {
          isValid: false,
          error: 'per_user_limit_reached',
          errorCode: 'per_user_limit_reached',
        };
      }
    }

    // Get price with product
    const price = await this.prisma.price.findUnique({
      where: { id: priceId },
      include: { product: true },
    });

    if (!price) {
      return { isValid: false, error: 'not_found', errorCode: 'not_found' };
    }

    // Check service scope
    if (promoCode.serviceId) {
      if (price.product.serviceId !== promoCode.serviceId) {
        return {
          isValid: false,
          error: 'wrong_service',
          errorCode: 'wrong_service',
        };
      }
    }

    const originalAmount = Number(price.amount);

    // Check min purchase amount
    if (
      promoCode.minPurchaseAmount !== null &&
      originalAmount < Number(promoCode.minPurchaseAmount)
    ) {
      return {
        isValid: false,
        error: 'min_purchase_not_met',
        errorCode: 'min_purchase_not_met',
        minPurchaseAmount: Number(promoCode.minPurchaseAmount),
      };
    }

    // Calculate discount
    let discountAmount: number;
    if (promoCode.discountType === 'percentage') {
      discountAmount = originalAmount * (Number(promoCode.discountValue) / 100);
    } else {
      // fixed_amount
      discountAmount = Number(promoCode.discountValue);
    }

    // Cap at maxDiscountAmount if set
    if (
      promoCode.maxDiscountAmount !== null &&
      discountAmount > Number(promoCode.maxDiscountAmount)
    ) {
      discountAmount = Number(promoCode.maxDiscountAmount);
    }

    // Cap at originalAmount (never negative)
    if (discountAmount > originalAmount) {
      discountAmount = originalAmount;
    }

    // Round to 4 decimal places
    discountAmount = Math.round(discountAmount * 10000) / 10000;
    const finalAmount = Math.round((originalAmount - discountAmount) * 10000) / 10000;

    return {
      isValid: true,
      promoCode,
      discountAmount,
      finalAmount,
      originalAmount,
    };
  }

  // ─── Apply ────────────────────────────────────────────────

  async applyPromoCode(
    promoCodeId: string,
    orderId: string,
    userId: string,
    originalAmount: number,
    discountAmount: number,
    finalAmount: number,
    tx?: any,
  ): Promise<void> {
    const db = tx || this.prisma;

    // Create usage record
    await db.promoCodeUsage.create({
      data: {
        promoCodeId,
        orderId,
        userId,
        discountApplied: discountAmount,
        originalAmount,
        finalAmount,
      },
    });

    // Guarded increment, matching the checkout path. An unguarded
    // `update` here would take a capped code past its cap the moment anything
    // started calling this instead.
    const promoCode = await db.promoCode.findUnique({ where: { id: promoCodeId } });
    const updated = await db.promoCode.updateMany({
      where: {
        id: promoCodeId,
        currentUsageCount: { lt: promoCode?.maxUsageCount ?? Number.MAX_SAFE_INTEGER },
      },
      data: { currentUsageCount: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Promo code usage limit reached');
    }
  }

  // ─── Admin CRUD ───────────────────────────────────────────

  async create(data: {
    code: string;
    name: string;
    description?: string;
    discountType: string;
    discountValue: number;
    serviceId?: string;
    minPurchaseAmount?: number;
    maxDiscountAmount?: number;
    validFrom: string;
    validUntil?: string;
    isActive?: boolean;
    maxUsageCount?: number;
    maxUsagePerUser?: number;
    metadata?: any;
  }) {
    if (!['percentage', 'fixed_amount'].includes(data.discountType)) {
      throw new BadRequestException('discountType must be "percentage" or "fixed_amount"');
    }

    // M4 fix: Validate discountValue > 0 for all discount types
    if (data.discountValue <= 0) {
      throw new BadRequestException('discountValue must be greater than 0');
    }

    if (data.discountType === 'percentage' && data.discountValue > 100) {
      throw new BadRequestException('Percentage discount must be between 0 and 100');
    }

    return this.prisma.promoCode.create({
      data: {
        code: data.code.toUpperCase(),
        name: data.name,
        description: data.description,
        discountType: data.discountType,
        discountValue: data.discountValue,
        serviceId: data.serviceId,
        minPurchaseAmount: data.minPurchaseAmount,
        maxDiscountAmount: data.maxDiscountAmount,
        validFrom: new Date(data.validFrom),
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        isActive: data.isActive ?? true,
        maxUsageCount: data.maxUsageCount,
        maxUsagePerUser: data.maxUsagePerUser ?? 1,
        metadata: data.metadata || {},
      },
    });
  }

  async findAll(params: { serviceId?: string; isActive?: boolean }) {
    const where: any = {};
    if (params.serviceId) where.serviceId = params.serviceId;
    if (params.isActive !== undefined) where.isActive = params.isActive;

    return this.prisma.promoCode.findMany({
      where,
      include: {
        service: true,
        _count: { select: { usages: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const promoCode = await this.prisma.promoCode.findUnique({
      where: { id },
      include: {
        service: true,
        _count: { select: { usages: true } },
      },
    });
    if (!promoCode) {
      throw new NotFoundException(`Promo code not found: ${id}`);
    }
    return promoCode;
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      discountType?: string;
      discountValue?: number;
      serviceId?: string;
      minPurchaseAmount?: number;
      maxDiscountAmount?: number;
      validFrom?: string;
      validUntil?: string;
      isActive?: boolean;
      maxUsageCount?: number;
      maxUsagePerUser?: number;
      metadata?: any;
    },
  ) {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Promo code not found: ${id}`);
    }

    if (data.discountType && !['percentage', 'fixed_amount'].includes(data.discountType)) {
      throw new BadRequestException('discountType must be "percentage" or "fixed_amount"');
    }

    const updateData: any = { ...data };
    if (data.validFrom) updateData.validFrom = new Date(data.validFrom);
    if (data.validUntil) updateData.validUntil = new Date(data.validUntil);

    return this.prisma.promoCode.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Promo code not found: ${id}`);
    }
    await this.prisma.promoCode.delete({ where: { id } });
  }

  async getUsageStats(id: string) {
    const promoCode = await this.prisma.promoCode.findUnique({
      where: { id },
    });
    if (!promoCode) {
      throw new NotFoundException(`Promo code not found: ${id}`);
    }

    const usages = await this.prisma.promoCodeUsage.findMany({
      where: { promoCodeId: id },
      orderBy: { appliedAt: 'desc' },
    });

    const totalDiscount = usages.reduce((sum, u) => sum + Number(u.discountApplied), 0);

    return {
      promoCode,
      totalUsages: usages.length,
      totalDiscount,
      usages,
    };
  }
}
