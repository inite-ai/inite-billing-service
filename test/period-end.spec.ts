import { calculatePeriodEnd } from '../src/payment-orchestrator/period.util';

const iso = (s: string) => new Date(s);

/**
 * Period-end math must be UTC and must never skip a month at month-end. The old
 * local-time setMonth/setFullYear overflowed Jan 31 + 1mo into March and drifted
 * across DST.
 */
describe('calculatePeriodEnd', () => {
  it('adds a month mid-month', () => {
    expect(calculatePeriodEnd(iso('2026-03-15T12:00:00.000Z'), 'month').toISOString()).toBe(
      '2026-04-15T12:00:00.000Z',
    );
  });

  it('clamps Jan 31 + 1 month to Feb 28 (non-leap) — does NOT skip to March', () => {
    expect(calculatePeriodEnd(iso('2026-01-31T00:00:00.000Z'), 'month').toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('clamps Jan 31 + 1 month to Feb 29 in a leap year', () => {
    expect(calculatePeriodEnd(iso('2028-01-31T00:00:00.000Z'), 'month').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('clamps May 31 + 1 month to Jun 30', () => {
    expect(calculatePeriodEnd(iso('2026-05-31T09:30:00.000Z'), 'month').toISOString()).toBe(
      '2026-06-30T09:30:00.000Z',
    );
  });

  it('adds a year and clamps Feb 29 → Feb 28', () => {
    expect(calculatePeriodEnd(iso('2028-02-29T00:00:00.000Z'), 'year').toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
  });

  it('preserves the exact UTC time of day (no DST drift)', () => {
    // A US spring-forward date — local-time math would shift this by an hour.
    const end = calculatePeriodEnd(iso('2026-03-08T02:30:00.000Z'), 'month');
    expect(end.toISOString()).toBe('2026-04-08T02:30:00.000Z');
  });

  it('handles day and week intervals (previously left unchanged → instant expiry)', () => {
    expect(calculatePeriodEnd(iso('2026-01-31T00:00:00.000Z'), 'day').toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    expect(calculatePeriodEnd(iso('2026-01-31T00:00:00.000Z'), 'week').toISOString()).toBe(
      '2026-02-07T00:00:00.000Z',
    );
  });

  it('defaults an unknown interval to one month rather than instant expiry', () => {
    expect(calculatePeriodEnd(iso('2026-03-15T00:00:00.000Z'), 'quarter').toISOString()).toBe(
      '2026-04-15T00:00:00.000Z',
    );
  });
});
