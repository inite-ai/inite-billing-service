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
 *
 * `anchor` is what the periods are counted from (Subscription.billingAnchor):
 * without it, Jan 31 → Feb 28 → Mar 28 loses the 31st for good. It is used
 * only while `start` still sits on the anchor's day, so a period the provider
 * moved is not pulled back.
 */
export function calculatePeriodEnd(start: Date, interval: string, anchor?: Date | null): Date {
  const end = new Date(start);
  const day = anchorDay(start, anchor);
  switch (interval) {
    case 'day':
      end.setUTCDate(end.getUTCDate() + 1);
      break;
    case 'week':
      end.setUTCDate(end.getUTCDate() + 7);
      break;
    case 'year':
      addUTCMonthsClamped(end, 12, day);
      break;
    case 'half_year':
    case '6months':
      addUTCMonthsClamped(end, 6, day);
      break;
    case 'quarter':
    case '3months':
      addUTCMonthsClamped(end, 3, day);
      break;
    case 'month':
    default:
      addUTCMonthsClamped(end, 1, day);
      break;
  }
  return end;
}

function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function anchorDay(start: Date, anchor?: Date | null): number {
  if (!anchor) return start.getUTCDate();
  const day = anchor.getUTCDate();
  return Math.min(day, daysInMonth(start)) === start.getUTCDate() ? day : start.getUTCDate();
}

/**
 * Add whole months in UTC, clamping the day of month so we never overflow into
 * the following month (and thus never skip a month). Preserves the time of day.
 */
function addUTCMonthsClamped(date: Date, months: number, day: number): void {
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(Math.min(day, daysInMonth(date)));
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
