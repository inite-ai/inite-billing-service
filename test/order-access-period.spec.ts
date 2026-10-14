import { orderAccessEndsAt } from '../src/payment-orchestrator/period.util';

/**
 * A one-time order for a priced period is that period of access
 * (inite.ai's annual Analyzer licence, paid once - 14.10.2026). Until then
 * every one-time order granted access with no end.
 */
describe('orderAccessEndsAt', () => {
  const start = new Date('2026-10-14T12:00:00Z');

  it('a price with no interval is kept for good', () => {
    expect(orderAccessEndsAt(start, null)).toBeNull();
    expect(orderAccessEndsAt(start, undefined)).toBeNull();
    expect(orderAccessEndsAt(start, '')).toBeNull();
  });

  it('a year paid once is twelve months of access', () => {
    expect(orderAccessEndsAt(start, 'year')?.toISOString()).toBe('2027-10-14T12:00:00.000Z');
  });

  it('a month paid once is a month', () => {
    expect(orderAccessEndsAt(start, 'month')?.toISOString()).toBe('2026-11-14T12:00:00.000Z');
  });

  it('grace days extend it, as they extend a subscription period', () => {
    expect(orderAccessEndsAt(start, 'year', 3)?.toISOString()).toBe('2027-10-17T12:00:00.000Z');
  });
});
