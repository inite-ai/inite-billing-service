/**
 * The payloads of `billing.credits.granted` and `billing.credits.revoked`,
 * built from the ledger rows they describe.
 *
 * Two readers depend on them being the same: the outbox delivery a service
 * receives when credits move, and `GET /v1/service-credits/grants`, which a
 * service reads to reconcile its own ledger against billing's. If the list
 * built its items its own way, a field added to one would be missing from the
 * other, and a reconciliation would report a mismatch that is only a format.
 * Both call these functions, on the same stored row, so they cannot drift.
 */

export const CREDITS_GRANTED = 'billing.credits.granted';
export const CREDITS_REVOKED = 'billing.credits.revoked';

export type CreditBucket = 'period' | 'purchased';

/** A `grant` ledger row as stored: what `recordGrant` wrote. */
export interface GrantRow {
  id: string;
  userId: string;
  orderId: string | null;
  amount: number;
  metadata: unknown;
}

const meta = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Grants written before the buckets existed have no bucket, and are purchased. */
const bucketOf = (m: Record<string, unknown>): CreditBucket =>
  m.bucket === 'period' ? 'period' : 'purchased';

/**
 * The granted event of a ledger row, or null for a grant that names no source
 * (an admin adjustment, a grant from before sources): those were never
 * announced to a service and are not part of what it reconciles.
 */
export function creditGrantedPayload(row: GrantRow): Record<string, unknown> | null {
  const m = meta(row.metadata);
  if (typeof m.source !== 'string') return null;
  return {
    grant_id: row.id,
    order_id: row.orderId ?? null,
    user_id: row.userId,
    company_id: textOrNull(m.companyId),
    source: m.source,
    bucket: bucketOf(m),
    amount: row.amount,
    period_start: textOrNull(m.periodStart),
    period_end: textOrNull(m.periodEnd),
  };
}

/**
 * The revoked event of a grant. `amount` is the whole grant, not what was left
 * of it to take back: a service with its own ledger expires on its own.
 */
export function creditRevokedPayload(revoke: {
  grant: { id: string; amount: number; metadata: unknown };
  userId: string;
  orderId: string;
}): Record<string, unknown> {
  const m = meta(revoke.grant.metadata);
  return {
    grant_id: revoke.grant.id,
    order_id: revoke.orderId,
    user_id: revoke.userId,
    company_id: textOrNull(m.companyId),
    bucket: bucketOf(m),
    amount: revoke.grant.amount,
  };
}
