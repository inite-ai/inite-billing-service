import { Decimal } from '@prisma/client/runtime/library';
import { roundMoney, toMoney } from '../common/money';

/**
 * How a change of plan is billed (owner, 30.10.2026):
 *
 * - **Upgrade** (a dearer price, same interval): the prorated difference is
 *   charged now, for the time left in the period, and the new plan starts at
 *   once. The period does not move, so the next renewal is the new plan's
 *   full price on the old date.
 * - **Downgrade** (a cheaper price, same interval): nothing is charged or
 *   refunded; the new plan starts at the end of the period already paid for.
 * - **Another interval** (monthly ↔ yearly): at the end of the period. A
 *   year paid up front is not prorated against a month, and a month is not
 *   refunded out of a year.
 * - **A no-card trial**: the change is free and immediate; the trial runs on.
 *
 * Pure: no database, no clock of its own.
 */

export interface PlanPrice {
  id: string;
  amount: Decimal | number | string;
  currency: string;
  interval: string | null;
}

export type ChangeDecision =
  | { effect: 'none' }
  | { effect: 'now_free' }
  | { effect: 'now_charge'; amount: Decimal }
  | { effect: 'period_end' };

export function decidePlanChange(input: {
  from: PlanPrice;
  to: PlanPrice;
  status: string;
  /** No rail: a trial started without a card, nothing paid yet. */
  unpaidTrial: boolean;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}): ChangeDecision {
  const { from, to } = input;
  if (from.id === to.id) return { effect: 'none' };
  if (input.unpaidTrial) return { effect: 'now_free' };
  if ((from.interval || null) !== (to.interval || null)) return { effect: 'period_end' };

  const fromAmount = toMoney(from.amount);
  const toAmount = toMoney(to.amount);
  if (toAmount.lte(fromAmount)) return { effect: 'period_end' };

  const difference = proratedDifference(fromAmount, toAmount, input);
  return difference.isZero()
    ? { effect: 'now_free' }
    : { effect: 'now_charge', amount: difference };
}

/**
 * The difference between two prices for the share of the period still ahead,
 * rounded to cents. Measured in milliseconds, so a change an hour before the
 * period ends costs an hour's worth.
 */
export function proratedDifference(
  fromAmount: Decimal,
  toAmount: Decimal,
  period: { periodStart: Date; periodEnd: Date; now: Date },
): Decimal {
  const total = period.periodEnd.getTime() - period.periodStart.getTime();
  const left = period.periodEnd.getTime() - period.now.getTime();
  if (total <= 0 || left <= 0) return toMoney(0);
  const share = Math.min(left, total);
  const difference = toAmount.minus(fromAmount);
  if (difference.lte(0)) return toMoney(0);
  return roundMoney(difference.mul(share).div(total));
}
