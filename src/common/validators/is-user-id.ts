import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength } from 'class-validator';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * A person's id as INITE Auth issues it.
 *
 * Not a UUID: the identity provider puts the person's DID in `sub`
 * (`did:key:…`, or `did:web:…` for an agent on its own), and that is the id
 * every billing row is keyed by — `user_id` is `VARCHAR(255)` throughout the
 * schema for exactly this reason. `@IsUUID()` on these fields refused every
 * person who signed in through OAuth: an operator could not grant them an
 * entitlement or adjust their credits, and a service could not charge them.
 *
 * A UUID (legacy ids) or a DID, within the column's length.
 */
export const PERSON_ID_PATTERN = new RegExp(`^(?:${UUID}|did:[a-z0-9]+:[A-Za-z0-9._:%-]+)$`);

/**
 * An organisation at INITE Auth as a subscriber: `org:<Organization.id>`, the
 * token's `org_id`. A company's plan in the family is held by its
 * organisation, not by whoever clicked (owner, 31.10.2026); how many people
 * use it is a limit of the plan.
 */
export const ORG_SUBSCRIBER_PATTERN = new RegExp(`^org:${UUID}$`);

/**
 * Who a billing row (subscription, entitlement, credits, order) belongs to:
 * a person or an organisation.
 */
export const USER_ID_PATTERN = new RegExp(
  `${PERSON_ID_PATTERN.source}|${ORG_SUBSCRIBER_PATTERN.source}`,
);

/** Whether an id names an organisation (`org:<uuid>`), not a person or a guest. */
export function isOrgSubscriber(id: string | null | undefined): boolean {
  return typeof id === 'string' && ORG_SUBSCRIBER_PATTERN.test(id);
}

/** The subscriber id of an auth organisation. */
export function orgSubscriber(orgId: string): string {
  return `org:${orgId.toLowerCase()}`;
}

/** A subscriber: a person (UUID or DID) or an organisation (`org:<uuid>`). */
export function IsUserId(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(255),
    Matches(USER_ID_PATTERN, { message: '$property must be a UUID, a DID or org:<uuid>' }),
  );
}

/** A person only (UUID or DID): for rows an organisation cannot own, such as a conversation. */
export function IsPersonId(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(255),
    Matches(PERSON_ID_PATTERN, { message: '$property must be a UUID or a DID' }),
  );
}
