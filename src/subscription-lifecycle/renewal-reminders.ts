export type ReminderStep = 'lead' | 'due' | 'mid' | 'last';

const DAY = 86_400_000;

interface RenewingSubscription {
  currentPeriodEnd: Date;
  price?: { graceDays?: number | null } | null;
}

/** When access ends if the renewal is not paid. */
export function accessEnds(sub: RenewingSubscription): Date {
  return new Date(new Date(sub.currentPeriodEnd).getTime() + (sub.price?.graceDays || 0) * DAY);
}

/**
 * Which letter this moment calls for, or null. Only the latest one: a sweep
 * that was late does not send three in a row. Without grace days there is
 * nothing to say after the period ends.
 */
export function reminderStep(sub: RenewingSubscription, now: Date): ReminderStep | null {
  const end = new Date(sub.currentPeriodEnd).getTime();
  const last = accessEnds(sub).getTime();
  const at = now.getTime();
  if (at < end) return 'lead';
  if (at >= last) return null;
  const grace = last - end;
  if (grace >= 2 * DAY && at >= last - DAY) return 'last';
  if (grace >= 3 * DAY && at >= end + grace / 2) return 'mid';
  return 'due';
}
