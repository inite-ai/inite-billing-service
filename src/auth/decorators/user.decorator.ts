import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  userId: string;
  roles: string[];
  email?: string;
  /** The identity provider confirmed `email` belongs to this user. */
  emailVerified?: boolean;
  isService?: boolean;
  serviceId?: string;
  serviceCode?: string;
}

export const User = createParamDecorator((data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
