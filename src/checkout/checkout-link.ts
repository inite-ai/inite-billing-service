import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * The secret a checkout link carries, so the buyer can pay without signing in
 * to billing. The selling service has already identified the buyer and opened
 * the order for them; making them sign in again on another domain only lost
 * purchases. The token travels in the URL fragment, which browsers never send
 * to a server, and the order keeps only its hash.
 */
export const CHECKOUT_LINK_HEADER = 'x-checkout-token';

export function newCheckoutLink(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashCheckoutLink(token) };
}

export function hashCheckoutLink(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Whether `token` opens the order whose metadata is given. A renewal holds
 * several (`linkTokenHashes`): one per letter sent, all good while it is unpaid.
 */
export function checkoutLinkMatches(metadata: unknown, token: string | undefined): boolean {
  const held = metadata as Record<string, unknown> | null;
  const stored = [
    held?.linkTokenHash,
    ...(Array.isArray(held?.linkTokenHashes) ? held.linkTokenHashes : []),
  ].filter((hash): hash is string => typeof hash === 'string');
  if (!token) return false;
  const a = Buffer.from(hashCheckoutLink(token), 'hex');
  let ok = false;
  for (const hash of stored) {
    const b = Buffer.from(hash, 'hex');
    if (a.length === b.length && timingSafeEqual(a, b)) ok = true;
  }
  return ok;
}

/** The token a request presents, if any. */
export function checkoutLinkFrom(request: {
  headers: Record<string, unknown>;
}): string | undefined {
  const value = request.headers[CHECKOUT_LINK_HEADER];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
