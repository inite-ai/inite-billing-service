import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

/**
 * Guard that accepts either JWT token OR service API key
 * Used for endpoints that work with both user requests (JWT) and service-to-service (API key)
 */
@Injectable()
export class JwtOrServiceGuard extends AuthGuard('jwt') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['x-api-key'] as string;

    // Try service API key first
    const serviceApiKey = this.configService.get<string>('SERVICE_API_KEY');
    if (serviceApiKey && authHeader === serviceApiKey) {
      request.user = {
        userId: null,
        roles: ['service'],
        isService: true,
      };
      return true;
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

