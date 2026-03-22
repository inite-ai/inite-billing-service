import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';

/**
 * Optional guard: if x-api-key is present, resolve service and attach to request.
 * If not present — request passes through without service context.
 * Never rejects — catalog is public.
 */
@Injectable()
export class OptionalServiceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string;

    if (apiKey) {
      const service = await this.prisma.service.findUnique({
        where: { apiKey },
      });
      if (service && service.isActive) {
        request.user = {
          userId: null,
          roles: ['service'],
          isService: true,
          serviceId: service.id,
          serviceCode: service.code,
        };
      }
    }

    return true; // Always allow — catalog is public
  }
}
