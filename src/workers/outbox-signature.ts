import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Outbox delivery signing (shared secret = the consuming Service's apiKey).
 *
 * Each `billing.*` webhook POST carries:
 *   x-billing-timestamp: <unix seconds>
 *   x-billing-signature: sha256=<hex HMAC-SHA256 of `${timestamp}.${rawBody}`>
 *
 * Consumers recompute the HMAC over the exact received body with their apiKey and
 * constant-time compare, plus reject stale timestamps (replay protection). The
 * signature authenticates the event: without it, anyone who learns a webhook URL
 * could POST a forged `billing.payment.succeeded`.
 */
export function signOutboxDelivery(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Consumer-side verification helper (also used in tests). Returns true only when
 * the signature matches AND the timestamp is within `toleranceSeconds` (default
 * 300) of now.
 */
export function verifyOutboxDelivery(params: {
  secret: string;
  timestamp: string;
  body: string;
  signature: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const tolerance = params.toleranceSeconds ?? 300;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(params.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;

  const expected = Buffer.from(signOutboxDelivery(params.secret, params.timestamp, params.body));
  const provided = Buffer.from(params.signature);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
