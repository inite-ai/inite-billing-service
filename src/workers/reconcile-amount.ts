import { IntentStatusResult } from '../common/interfaces/payment-rail-adapter.interface';

export interface AmountReconcileResult {
  /** Whether the paid webhook may settle the order. */
  ok: boolean;
  /** Why it was rejected (only when !ok). */
  reason?: 'amount_too_low' | 'currency_mismatch' | 'amount_unverifiable';
  /** Whether the amount could actually be checked (adapter supplied a normalized amount). */
  reconciled: boolean;
}

// Money is compared in major units; allow a sub-cent epsilon for float noise.
const EPSILON = 0.005;

/**
 * Reconcile a provider-reported settlement against the order before marking it
 * paid. Uses the adapter's NORMALIZED {@link IntentStatusResult.amount} /
 * `currency` (major units) — never raw provider fields, which differ in name and
 * unit per rail (Stripe cents under `amount`/`amount_total`, etc.).
 *
 * An adapter that supplies neither a normalized amount nor
 * {@link IntentStatusResult.amountVerifiedByAdapter} has given no evidence that
 * the customer paid what the order says, and the settlement is refused. This
 * used to pass — silence was read as consent, so on any rail that does not
 * report an amount an underpayment settled in full.
 */
export function reconcileAmount(
  order: { amount: unknown; currency: string },
  result: Pick<IntentStatusResult, 'amount' | 'currency' | 'amountVerifiedByAdapter'>,
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

  // No amount, but the adapter has checked it against the intent itself (the
  // app stores charge their own configured price; the crypto adapter verifies
  // the on-chain transfer before reporting paid).
  if (result.amountVerifiedByAdapter) {
    return { ok: true, reconciled: true };
  }

  return { ok: false, reason: 'amount_unverifiable', reconciled: false };
}
