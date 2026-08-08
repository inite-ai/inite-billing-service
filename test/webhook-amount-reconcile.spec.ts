import { reconcileAmount } from '../src/workers/reconcile-amount';
import { StripeAdapter } from '../src/adapters/stripe/stripe.adapter';

/**
 * The webhook processor's amount check compared raw provider fields (Stripe
 * sends cents under `amount`/`amount_total`, not `amountTotal.amount`/
 * `total_amount`) against the order amount in dollars — so cents < dollars was
 * always false and underpayments slipped through. Reconciliation now uses the
 * adapter's normalized (major-unit) amount/currency.
 */
describe('reconcileAmount', () => {
  const order = { amount: 10 as any, currency: 'USD' };

  it('accepts an exact payment', () => {
    expect(reconcileAmount(order, { amount: 10, currency: 'USD' })).toEqual({
      ok: true,
      reconciled: true,
    });
  });

  it('accepts an overpayment', () => {
    expect(reconcileAmount(order, { amount: 12, currency: 'USD' }).ok).toBe(true);
  });

  it('rejects an underpayment (the bug: cents-vs-dollars hid this)', () => {
    const r = reconcileAmount(order, { amount: 5, currency: 'USD' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('amount_too_low');
  });

  it('rejects even a one-cent underpayment', () => {
    expect(reconcileAmount(order, { amount: 9.99, currency: 'USD' }).ok).toBe(false);
  });

  it('rejects a currency mismatch', () => {
    const r = reconcileAmount(order, { amount: 10, currency: 'EUR' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('currency_mismatch');
  });

  it('is case-insensitive on currency', () => {
    expect(reconcileAmount(order, { amount: 10, currency: 'usd' }).ok).toBe(true);
  });

  it('skips (does not falsely fail) when the adapter gives no normalized amount', () => {
    expect(reconcileAmount(order, {})).toEqual({ ok: true, reconciled: false });
  });

  it('handles a Decimal-like order amount', () => {
    const decimalOrder = { amount: { toString: () => '10.00' } as any, currency: 'USD' };
    expect(reconcileAmount(decimalOrder, { amount: 4, currency: 'USD' }).ok).toBe(false);
  });
});

describe('StripeAdapter.getIntentStatus normalizes cents to major units', () => {
  const buildAdapter = (piResponse: any) => {
    const prisma: any = {
      paymentProvider: {
        findUnique: jest.fn().mockResolvedValue({ isActive: true, config: { secretKey: 'sk' } }),
      },
    };
    const adapter = new StripeAdapter(prisma);
    jest.spyOn(adapter as any, 'stripeRequest').mockResolvedValue(piResponse);
    return adapter;
  };

  it('reports amount in dollars (cents / 100) for a PaymentIntent', async () => {
    const adapter = buildAdapter({
      id: 'pi_1',
      amount: 1000,
      currency: 'usd',
      status: 'succeeded',
    });
    const res = await adapter.getIntentStatus('pi_1');
    expect(res.status).toBe('paid');
    expect(res.amount).toBe(10);
    expect(res.currency).toBe('USD');
    // The end-to-end guarantee: a $10 order is NOT underpaid by a $10 Stripe PI.
    expect(reconcileAmount({ amount: 10, currency: 'USD' }, res).ok).toBe(true);
  });

  it('catches a Stripe underpayment once normalized', async () => {
    const adapter = buildAdapter({ id: 'pi_2', amount: 500, currency: 'usd', status: 'succeeded' });
    const res = await adapter.getIntentStatus('pi_2');
    expect(res.amount).toBe(5);
    expect(reconcileAmount({ amount: 10, currency: 'USD' }, res).ok).toBe(false);
  });
});
