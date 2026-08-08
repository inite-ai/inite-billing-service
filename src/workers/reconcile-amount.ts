import { IntentStatusResult } from '../common/interfaces/payment-rail-adapter.interface';

export interface AmountReconcileResult {
  /** Whether the paid webhook may settle the order. */
  ok: boolean;
  /** Why it was rejected (only when !ok). */
  reason?: 'amount_too_low' | 'currency_mismatch';
  /** Whether the amount could actually be checked (adapter supplied a normalized amount). */
  reconciled: boolean;
}

// Money is compared in major units; allow a sub-cent epsilon for float noise.
const EPSILON = 0.005;

/**
 * Reconcile a provider-reported settlement against the order before marking it
 * paid. Uses the adapter's NORMALIZED {@link IntentStatusResult.amount} /
 * `currency` (major units) — never raw provider fields, which differ in name and
 * unit per rail (Stripe cents under `amount`/`amount_total`, etc.). If the
 * adapter did not supply a normalized amount the amount cannot be checked, and
 * this returns `{ ok: true, reconciled: false }` so the caller can log rather
 * than silently pass a bogus comparison.
 */
export function reconcileAmount(
  order: { amount: unknown; currency: string },
  result: Pick<IntentStatusResult, 'amount' | 'currency'>,
): AmountReconcileResult {
  const orderAmount = Number(order.amount);
  const orderCurrency = String(order.currency || '').toUpperCase();
  const providerCurrency = result.currency ? String(result.currency).toUpperCase() : undefined;

  if (providerCurrency && orderCurrency && providerCurrency !== orderCurrency) {
    return { ok: false, reason: 'currency_mismatch', reconciled: true };
  }

  if (typeof result.amount === 'number' && !Number.isNaN(result.amount)) {
    if (result.amount < orderAmount - EPSILON) {
      return { ok: false, reason: 'amount_too_low', reconciled: true };
    }
    return { ok: true, reconciled: true };
  }

  return { ok: true, reconciled: false };
}
