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

  /**
   * Read a user's entitlements on behalf of another caller.
   *
   * When `callerServiceId` is given (a service-to-service read), the result is
   * scoped to entitlements owned by THAT service — a service must not see other
   * services' grants (IDOR). Legacy rows granted before scoping existed carry no
   * `value.service_id` and stay visible during the transition, so existing
   * access checks don't regress. A JWT user read (no callerServiceId) sees all
   * of their own entitlements across services, unchanged.
   */
  async getUserEntitlementsByUserId(
    userId: string,
    callerServiceId?: string,
  ): Promise<EntitlementResponseDto[]> {
    const entitlements = await this.getUserEntitlements(userId);
    if (!callerServiceId) return entitlements;
    return entitlements.filter((e) => {
      const serviceId = (e.value as Record<string, any> | undefined)?.service_id;
      return serviceId == null || serviceId === callerServiceId;
    });
  }
}
