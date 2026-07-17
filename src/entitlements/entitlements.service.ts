import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { EntitlementResponseDto } from '../common/dto/entitlement.dto';

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserEntitlements(userId: string): Promise<EntitlementResponseDto[]> {
    const entitlements = await this.prisma.entitlement.findMany({
      where: {
        userId,
        status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return entitlements.map((e) => ({
      id: e.id,
      userId: e.userId,
      key: e.key,
      status: e.status,
      value: e.value as Record<string, any> | undefined,
      source: e.source,
      startsAt: e.startsAt || undefined,
      expiresAt: e.expiresAt || undefined,
      createdAt: e.createdAt,
    }));
  }

  async getUserEntitlementsByUserId(userId: string): Promise<EntitlementResponseDto[]> {
    return this.getUserEntitlements(userId);
  }
}
