/**
 * Compute a subscription's period end from its start and billing interval.
 *
 * All arithmetic is in UTC. Subscription timestamps are Timestamptz, and the
 * previous implementation used local-time `setMonth`/`setFullYear`, which:
 *   - drifted by an hour across DST boundaries (the wall-clock time was
 *     preserved, so the UTC instant moved); and
 *   - skipped a month at month-end — `Jan 31 + 1 month` overflowed to Mar 3
 *     because Feb 31 doesn't exist.
 *
 * Month/year steps clamp the day to the target month's length, so
 * `Jan 31 + 1mo → Feb 28/29` and `Feb 29 + 1yr → Feb 28`. day/week were
 * previously unhandled (period end == start → immediate expiry); they now add
 * the right number of days.
 */
export function calculatePeriodEnd(start: Date, interval: string): Date {
  const end = new Date(start);
  switch (interval) {
    case 'day':
      end.setUTCDate(end.getUTCDate() + 1);
      break;
    case 'week':
      end.setUTCDate(end.getUTCDate() + 7);
      break;
    case 'year':
      addUTCMonthsClamped(end, 12);
      break;
    case 'month':
    default:
      addUTCMonthsClamped(end, 1);
      break;
  }
  return end;
}

/**
 * Add whole months in UTC, clamping the day of month so we never overflow into
 * the following month (and thus never skip a month). Preserves the time of day.
 */
function addUTCMonthsClamped(date: Date, months: number): void {
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, daysInTargetMonth));
}

/**
 * When access bought by a one-time order ends.
 *
 * A price without an interval is a thing bought once and kept: no end. A price
 * WITH one, paid once rather than subscribed to, is that period of access -
 * inite.ai sells its annual Analyzer plan as a twelve-month licence paid once
 * (owner, 14.10.2026, for Google Merchant). Until then every one-time order
 * granted `expiresAt: null`, so a year paid once would have been access for
 * ever. Grace days extend it as they extend a subscription's period.
 */
export function orderAccessEndsAt(
  start: Date,
  interval: string | null | undefined,
  graceDays?: number | null,
): Date | null {
  if (!interval) return null;
  const end = calculatePeriodEnd(start, interval);
  return graceDays ? new Date(end.getTime() + graceDays * 24 * 60 * 60 * 1000) : end;
}
