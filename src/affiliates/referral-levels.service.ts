import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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

    // Check that levels are sequential
    const existingLevels = await this.prisma.referralLevel.findMany({
      where: { serviceId: data.serviceId },
      orderBy: { level: 'asc' },
    });

    const maxLevel = existingLevels.length > 0
      ? Math.max(...existingLevels.map((l) => l.level))
      : 0;

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

    this.logger.log(
      `Created referral level ${data.level} for service ${data.serviceId}`,
    );

    return level;
  }

  async updateLevel(
    id: string,
    data: { commissionRate?: number; name?: string; isActive?: boolean; qualificationCriteria?: Record<string, any> },
  ) {
    const level = await this.prisma.referralLevel.findUnique({
      where: { id },
    });
    if (!level) {
      throw new NotFoundException(`Referral level not found: ${id}`);
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

  async getCommissionRateForLevel(
    serviceId: string,
    level: number,
  ): Promise<number | null> {
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
