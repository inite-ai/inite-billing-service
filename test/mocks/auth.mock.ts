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
