import { Decimal } from '@prisma/client/runtime/library';

/**
 * Commission balances, per currency, read straight off the ledger.
 *
 * A commission ledger is per-currency by nature: a €10 commission and a $10
 * commission are not €20, and no exchange rate the billing service is entitled
 * to invent turns them into one number. `Affiliate.totalEarned` / `totalPaid`
 * are single scalars that add both, so they can only ever be a cross-currency
 * roll-up. They stay (the existing API and the admin UI read them), but nothing
 * authorises a payment off them any more — the commission rows do.
 *
 * Deriving the balance also means a voided commission disappears from it by
 * construction, instead of having to be subtracted from a running total that
 * remembers it.
 */
export interface CurrencyBalance {
  currency: string;
  /** Awaiting settlement — still inside the refund window. */
  pending: string;
  /** Settled and not yet covered by a payout. This is what can be withdrawn. */
  available: string;
  /** Settled ever, in this currency (available + paid). */
  earned: string;
  /** Covered by a payout. */
  paid: string;
}

const ZERO = new Decimal(0);

interface Bucket {
  pending: Decimal;
  available: Decimal;
  paid: Decimal;
}

/**
 * Sum every non-voided commission by (currency, status). Voided rows are simply
 * absent: a refunded sale leaves the ledger rather than being compensated for.
 */
export async function currencyBalances(db: any, affiliateId: string): Promise<CurrencyBalance[]> {
  const rows = await db.affiliateCommission.groupBy({
    by: ['currency', 'status'],
    where: { affiliateId, status: { in: ['pending', 'earned', 'paid'] } },
    _sum: { amount: true },
  });

  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const currency = String(row.currency).toUpperCase();
    const bucket = buckets.get(currency) ?? { pending: ZERO, available: ZERO, paid: ZERO };
    const amount = new Decimal(row._sum?.amount ?? 0);

    if (row.status === 'pending') bucket.pending = bucket.pending.plus(amount);
    else if (row.status === 'earned') bucket.available = bucket.available.plus(amount);
    else bucket.paid = bucket.paid.plus(amount);

    buckets.set(currency, bucket);
  }

  return [...buckets.entries()]
    .map(([currency, b]) => ({
      currency,
      pending: b.pending.toFixed(4),
      available: b.available.toFixed(4),
      earned: b.available.plus(b.paid).toFixed(4),
      paid: b.paid.toFixed(4),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** What this affiliate can actually withdraw in one currency, right now. */
export async function availableIn(
  db: any,
  affiliateId: string,
  currency: string,
): Promise<Decimal> {
  const total = await db.affiliateCommission.aggregate({
    where: {
      affiliateId,
      status: 'earned',
      payoutId: null,
      currency: currency.toUpperCase(),
    },
    _sum: { amount: true },
  });
  return new Decimal(total._sum?.amount ?? 0);
}
