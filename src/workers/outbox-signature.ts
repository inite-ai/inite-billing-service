import { createHmac, timingSafeEqual } from 'crypto';
import { openKey, sealKey } from '../common/key-seal';

/**
 * Outbox delivery signing (shared secret = the consuming Service's webhook
 * secret when it has one, else its apiKey).
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

/** What a sealed webhook secret is bound to, so it opens only on its own service. */
function secretBinding(serviceId: string): string {
  return `service-webhook:${serviceId}`;
}

export function sealWebhookSecret(secret: string, serviceId: string): string {
  return sealKey(secret, secretBinding(serviceId));
}

/**
 * The secret this service's webhooks are signed with: its own webhook secret
 * when it has one (a service that signs in only with an INITE Auth token
 * holds no static key), its apiKey otherwise, as before. Throws when the
 * secret cannot be opened: an unsigned or wrongly signed delivery is worse
 * than a late one.
 */
export function webhookSigningSecret(service: {
  id: string;
  apiKey: string;
  webhookSecret?: string | null;
}): string {
  if (service.webhookSecret) return openKey(service.webhookSecret, secretBinding(service.id));
  return service.apiKey;
}
