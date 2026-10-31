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
  /** The agent's OAuth client, with `actor`. */
  actorClientId?: string;
  /** The token's audience(s): the resource it was issued for. */
  audience?: string[];
  /** Granted scopes. */
  scopes?: string[];
  /** RFC 9396 authorization_details carried by the token. */
  authorizationDetails?: Array<Record<string, unknown>>;
  /** The organisation the token acts for (its `org_id`), lower-case. */
  orgId?: string;
  /** The person's role in `orgId` (its `org_role`), lower-case. */
  orgRole?: string;
  isService?: boolean;
  serviceId?: string;
  serviceCode?: string;
}

export const User = createParamDecorator((data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
