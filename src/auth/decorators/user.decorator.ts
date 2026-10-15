import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  userId: string;
  roles: string[];
  email?: string;
  /** The identity provider confirmed `email` belongs to this user. */
  emailVerified?: boolean;
  /**
   * The agent acting for the user, when the token is an agent's (INITE Auth
   * puts it in `act`): its DID. Absent when the person acts themselves.
   */
  actor?: string;
  isService?: boolean;
  serviceId?: string;
  serviceCode?: string;
}

export const User = createParamDecorator((data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
