import { BadRequestException } from '@nestjs/common';
import { USER_ID_PATTERN, isOrgSubscriber } from '../common/validators/is-user-id';

/** The calling service's own guest id, `<service>:<id>`. */
export const BUYER_PATTERN = /^(?:[a-z0-9][a-z0-9_-]{0,99}:[A-Za-z0-9_-]{8,128})$/;

/** What a service may name as the buyer: a person, an organisation (`org:<uuid>`), or a guest id it made up. */
export const SERVICE_BUYER_PATTERN = new RegExp(
  `${USER_ID_PATTERN.source}|${BUYER_PATTERN.source}`,
);

/** A guest id is namespaced by the service that made it up, never another's. */
export function assertOwnGuestId(userId: string, serviceCode: string | null | undefined): void {
  // An organisation is a subscriber of its own, not a guest of the service.
  if (isOrgSubscriber(userId)) return;
  if (!userId.startsWith('did:') && userId.includes(':')) {
    if (!serviceCode || !userId.startsWith(`${serviceCode}:`)) {
      throw new BadRequestException(`A guest id is ${serviceCode}:<id>`);
    }
  }
}
