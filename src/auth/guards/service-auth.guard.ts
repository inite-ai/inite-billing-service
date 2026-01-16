import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['x-api-key'] as string;

    const serviceApiKey = this.configService.get<string>('SERVICE_API_KEY');

    if (!serviceApiKey) {
      // If no service API key is configured, deny access
      throw new UnauthorizedException('Service authentication not configured');
    }

    if (!authHeader || authHeader !== serviceApiKey) {
      throw new UnauthorizedException('Invalid service API key');
    }

    // Set user context for service requests
    request.user = {
      userId: null, // Service requests don't have a user
      roles: ['service'],
      isService: true,
    };

    return true;
  }
}

