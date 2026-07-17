import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';

@Injectable()
export class ReferralLevelsService {
  private readonly logger = new Logger(ReferralLevelsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getLevelsByService(serviceId: string) {
    return this.prisma.referralLevel.findMany({
      where: { serviceId },
      orderBy: { level: 'asc' },
    });
  }

  async getAllLevels(serviceId?: string) {
    const where: any = {};
    if (serviceId) where.serviceId = serviceId;

    return this.prisma.referralLevel.findMany({
      where,
      orderBy: [{ serviceId: 'asc' }, { level: 'asc' }],
      include: { service: true },
    });
  }

  async createLevel(data: {
    serviceId: string;
    level: number;
    commissionRate: number;
    name: string;
    qualificationCriteria?: Record<string, any>;
  }) {
    // Validate service exists
    const service = await this.prisma.service.findUnique({
      where: { id: data.serviceId },
    });
    if (!service) {
      throw new NotFoundException(`Service not found: ${data.serviceId}`);
    }

    // Validate commission rate bounds (C5)
    if (data.commissionRate < 0 || data.commissionRate > 1) {
      throw new BadRequestException('commissionRate must be between 0 and 1 (inclusive)');
    }

    // Check that levels are sequential
    const existingLevels = await this.prisma.referralLevel.findMany({
      where: { serviceId: data.serviceId },
      orderBy: { level: 'asc' },
    });

    const maxLevel =
      existingLevels.length > 0 ? Math.max(...existingLevels.map((l) => l.level)) : 0;

    if (data.level !== maxLevel + 1) {
      throw new BadRequestException(
        `Level must be sequential. Next level should be ${maxLevel + 1}`,
      );
    }

    const level = await this.prisma.referralLevel.create({
      data: {
        serviceId: data.serviceId,
        level: data.level,
        commissionRate: data.commissionRate,
        name: data.name,
        qualificationCriteria: data.qualificationCriteria || {},
      },
    });

    this.logger.log(`Created referral level ${data.level} for service ${data.serviceId}`);

    return level;
  }

  async updateLevel(
    id: string,
    data: {
      commissionRate?: number;
      name?: string;
      isActive?: boolean;
      qualificationCriteria?: Record<string, any>;
    },
  ) {
    const level = await this.prisma.referralLevel.findUnique({
      where: { id },
    });
    if (!level) {
      throw new NotFoundException(`Referral level not found: ${id}`);
    }

    // Validate commission rate bounds (C5)
    if (data.commissionRate !== undefined && (data.commissionRate < 0 || data.commissionRate > 1)) {
      throw new BadRequestException('commissionRate must be between 0 and 1 (inclusive)');
    }

    return this.prisma.referralLevel.update({
      where: { id },
      data,
    });
  }

  async deleteLevel(id: string) {
    const level = await this.prisma.referralLevel.findUnique({
      where: { id },
    });
    if (!level) {
      throw new NotFoundException(`Referral level not found: ${id}`);
    }

    // Only allow deleting the highest level for a service
    const maxLevel = await this.prisma.referralLevel.findFirst({
      where: { serviceId: level.serviceId },
      orderBy: { level: 'desc' },
    });

    if (maxLevel && maxLevel.level !== level.level) {
      throw new BadRequestException(
        `Can only delete the highest level. Delete level ${maxLevel.level} first.`,
      );
    }

    return this.prisma.referralLevel.delete({ where: { id } });
  }

  /**
   * Built-in referral level templates
   */
  static readonly TEMPLATES: Record<
    string,
    {
      name: string;
      description: string;
      totalRate: number;
      levels: { level: number; rate: number; name: string; criteria?: Record<string, any> }[];
    }
  > = {
    'inite-7-level-30': {
      name: 'INITE 7-Level (30%)',
      description: '7 levels, 30% total commission. Standard INITE referral program.',
      totalRate: 0.3,
      levels: [
        { level: 1, rate: 0.15, name: 'Direct Referral' },
        { level: 2, rate: 0.01, name: 'Level 2' },
        { level: 3, rate: 0.015, name: 'Level 3' },
        { level: 4, rate: 0.02, name: 'Level 4' },
        { level: 5, rate: 0.03, name: 'Level 5' },
        { level: 6, rate: 0.035, name: 'Level 6' },
        { level: 7, rate: 0.04, name: 'Level 7' },
      ],
    },
    'inite-7-level-30-qualified': {
      name: 'INITE 7-Level (30%) + Qualification',
      description: '7 levels, 30% total. L2+ require min referrals + personal purchase.',
      totalRate: 0.3,
      levels: [
        { level: 1, rate: 0.15, name: 'Direct Referral' },
        {
          level: 2,
          rate: 0.01,
          name: 'Level 2',
          criteria: { minDirectReferrals: 3, personalPurchaseRequired: true },
        },
        {
          level: 3,
          rate: 0.015,
          name: 'Level 3',
          criteria: { minDirectReferrals: 5, minActiveReferrals: 2 },
        },
        {
          level: 4,
          rate: 0.02,
          name: 'Level 4',
          criteria: { minDirectReferrals: 10, minActiveReferrals: 5 },
        },
        {
          level: 5,
          rate: 0.03,
          name: 'Level 5',
          criteria: { minDirectReferrals: 15, minActiveReferrals: 7 },
        },
        {
          level: 6,
          rate: 0.035,
          name: 'Level 6',
          criteria: { minDirectReferrals: 20, minActiveReferrals: 10, minMonthlyVolume: 100 },
        },
        {
          level: 7,
          rate: 0.04,
          name: 'Level 7',
          criteria: { minDirectReferrals: 30, minActiveReferrals: 15, minMonthlyVolume: 500 },
        },
      ],
    },
    'simple-3-level-20': {
      name: 'Simple 3-Level (20%)',
      description: '3 levels, 20% total. Easy entry for new services.',
      totalRate: 0.2,
      levels: [
        { level: 1, rate: 0.15, name: 'Direct Referral' },
        { level: 2, rate: 0.03, name: 'Level 2' },
        { level: 3, rate: 0.02, name: 'Level 3' },
      ],
    },
    'aggressive-5-level-25': {
      name: 'Aggressive 5-Level (25%)',
      description: '5 levels, 25% total. Balanced growth incentive.',
      totalRate: 0.25,
      levels: [
        { level: 1, rate: 0.12, name: 'Direct Referral' },
        { level: 2, rate: 0.05, name: 'Level 2' },
        { level: 3, rate: 0.04, name: 'Level 3' },
        { level: 4, rate: 0.025, name: 'Level 4' },
        { level: 5, rate: 0.015, name: 'Level 5' },
      ],
    },
  };

  /**
   * Get all available templates
   */
  getTemplates() {
    return Object.entries(ReferralLevelsService.TEMPLATES).map(([key, tmpl]) => ({
      key,
      ...tmpl,
    }));
  }

  /**
   * Apply a template to a service (creates all levels at once)
   * Fails if service already has levels configured.
   */
  async applyTemplate(serviceId: string, templateKey: string) {
    const template = ReferralLevelsService.TEMPLATES[templateKey];
    if (!template) {
      throw new BadRequestException(
        `Template not found: ${templateKey}. Available: ${Object.keys(ReferralLevelsService.TEMPLATES).join(', ')}`,
      );
    }

    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      throw new NotFoundException(`Service not found: ${serviceId}`);
    }

    // Check no levels exist yet
    const existing = await this.prisma.referralLevel.count({ where: { serviceId } });
    if (existing > 0) {
      throw new BadRequestException(
        `Service already has ${existing} referral levels. Delete them first to apply a template.`,
      );
    }

    // Create all levels in a transaction
    const created = await this.prisma.$transaction(
      template.levels.map((lvl) =>
        this.prisma.referralLevel.create({
          data: {
            serviceId,
            level: lvl.level,
            commissionRate: lvl.rate,
            name: lvl.name,
            qualificationCriteria: lvl.criteria || {},
          },
        }),
      ),
    );

    this.logger.log(
      `Applied template "${templateKey}" to service ${serviceId}: ${created.length} levels created`,
    );

    return {
      template: templateKey,
      templateName: template.name,
      levels: created,
    };
  }

  async getCommissionRateForLevel(serviceId: string, level: number): Promise<number | null> {
    const referralLevel = await this.prisma.referralLevel.findUnique({
      where: {
        serviceId_level: { serviceId, level },
      },
    });

    if (!referralLevel || !referralLevel.isActive) {
      return null;
    }

    return Number(referralLevel.commissionRate);
  }
}
