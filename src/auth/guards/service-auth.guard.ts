import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string;

    if (!apiKey) {
      throw new UnauthorizedException('Missing x-api-key header');
    }

    const service = await this.prisma.service.findUnique({
      where: { apiKey },
    });

    if (!service) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!service.isActive) {
      throw new UnauthorizedException('Service is inactive');
    }

    request.user = {
      userId: null,
      roles: ['service'],
      isService: true,
      serviceId: service.id,
      serviceCode: service.code,
    };

    return true;
  }
}
