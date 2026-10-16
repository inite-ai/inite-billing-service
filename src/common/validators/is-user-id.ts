import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * A customer's id as INITE Auth issues it.
 *
 * Not a UUID: the identity provider puts the person's DID in `sub`
 * (`did:key:…`, or `did:web:…` for an agent on its own), and that is the id
 * every billing row is keyed by — `user_id` is `VARCHAR(255)` throughout the
 * schema for exactly this reason. `@IsUUID()` on these fields refused every
 * person who signed in through OAuth: an operator could not grant them an
 * entitlement or adjust their credits, and a service could not charge them.
 *
 * Accepts a UUID (legacy ids) or a DID, within the column's length.
 */
export const USER_ID_PATTERN =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|did:[a-z0-9]+:[A-Za-z0-9._:%-]+)$/;

export function IsUserId(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(255),
    Matches(USER_ID_PATTERN, { message: '$property must be a UUID or a DID' }),
  );
}
