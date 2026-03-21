import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../common/services/prisma.service';

/**
 * Guard that accepts either JWT token OR service API key
 * Used for endpoints that work with both user requests (JWT) and service-to-service (API key)
 */
@Injectable()
export class JwtOrServiceGuard extends AuthGuard('jwt') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string;

    // Try service API key first
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
        return true;
      }
    }

    // Try JWT
    try {
      const result = await super.canActivate(context);
      return result as boolean;
    } catch {
      throw new UnauthorizedException(
        'Authentication required: provide JWT token or service API key',
      );
    }
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
