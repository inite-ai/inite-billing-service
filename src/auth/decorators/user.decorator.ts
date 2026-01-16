import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  userId: string;
  roles: string[];
  email?: string;
  isService?: boolean;
}

export const User = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

