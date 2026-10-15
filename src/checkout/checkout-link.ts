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

/** Whether `token` opens the order whose metadata is given. */
export function checkoutLinkMatches(metadata: unknown, token: string | undefined): boolean {
  const stored = (metadata as Record<string, unknown> | null)?.linkTokenHash;
  if (!token || typeof stored !== 'string') return false;
  const a = Buffer.from(hashCheckoutLink(token), 'hex');
  const b = Buffer.from(stored, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The token a request presents, if any. */
export function checkoutLinkFrom(request: {
  headers: Record<string, unknown>;
}): string | undefined {
  const value = request.headers[CHECKOUT_LINK_HEADER];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
