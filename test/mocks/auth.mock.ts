import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class MockJwtAuthGuard extends AuthGuard('jwt') {
  static testUserId: string = '00000000-0000-0000-0000-000000000001';
  static testUserRoles: string[] = ['user'];

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.user = {
      userId: MockJwtAuthGuard.testUserId,
      roles: MockJwtAuthGuard.testUserRoles,
      email: 'test@example.com',
    };
    return true;
  }
}

/**
 * Stand-in for `JwtOrServiceGuard`. That guard accepts either a JWT or a
 * service API key, so specs that only override `JwtAuthGuard` leave it live
 * and every request to a dual-auth route 401s. It injects the same user as
 * `MockJwtAuthGuard` — e2e specs drive the JWT-user path.
 */
@Injectable()
export class MockJwtOrServiceGuard extends MockJwtAuthGuard {}
