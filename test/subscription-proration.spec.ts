import { decidePlanChange, proratedDifference } from '../src/subscription-lifecycle/proration';
import { toMoney } from '../src/common/money';

/**
 * Owner's rule (30.10.2026): an upgrade charges the prorated difference now,
 * a downgrade takes effect at period end. A change of interval is never
 * prorated, and a no-card trial changes for free.
 */
describe('plan change proration', () => {
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-12-01T00:00:00Z'); // 30 days
  const mid = new Date('2026-11-16T00:00:00Z'); // 15 days left
  const price = (id: string, amount: number, interval = 'month') => ({
    id,
    amount,
    currency: 'USD',
    interval,
  });
  const base = {
    status: 'active',
    unpaidTrial: false,
    periodStart: start,
    periodEnd: end,
    now: mid,
  };

  it('charges half the difference halfway through the month', () => {
    const d = decidePlanChange({ ...base, from: price('a', 29), to: price('b', 79) });
    expect(d).toEqual({ effect: 'now_charge', amount: toMoney('25.00') });
  });

  it('rounds the difference to cents', () => {
    const now = new Date('2026-11-21T00:00:00Z'); // 10 of 30 days left
    const d = decidePlanChange({ ...base, now, from: price('a', 15), to: price('b', 39) });
    expect(d).toEqual({ effect: 'now_charge', amount: toMoney('8.00') });
    expect(
      proratedDifference(toMoney(39), toMoney(99), {
        periodStart: start,
        periodEnd: end,
        now,
      }).toFixed(2),
    ).toBe('20.00');
  });

  it('schedules a downgrade for the end of the period and charges nothing', () => {
    expect(decidePlanChange({ ...base, from: price('a', 79), to: price('b', 29) })).toEqual({
      effect: 'period_end',
    });
  });

  it('never prorates across intervals', () => {
    expect(
      decidePlanChange({ ...base, from: price('a', 29), to: price('b', 290, 'year') }),
    ).toEqual({ effect: 'period_end' });
    expect(
      decidePlanChange({ ...base, from: price('a', 290, 'year'), to: price('b', 79) }),
    ).toEqual({ effect: 'period_end' });
  });

  it('changes a no-card trial at once and for free', () => {
    expect(
      decidePlanChange({ ...base, unpaidTrial: true, from: price('a', 29), to: price('b', 149) }),
    ).toEqual({ effect: 'now_free' });
  });

  it('charges nothing for an upgrade once the period is over', () => {
    const now = new Date('2026-12-02T00:00:00Z');
    expect(decidePlanChange({ ...base, now, from: price('a', 29), to: price('b', 79) })).toEqual({
      effect: 'now_free',
    });
  });

  it('does nothing for the same price', () => {
    expect(decidePlanChange({ ...base, from: price('a', 29), to: price('a', 29) })).toEqual({
      effect: 'none',
    });
  });
});
