import type { CommitmentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export type Actor = 'system' | 'service' | 'admin';

/** Rows in these states are done: nothing moves them again. */
export const SETTLED: readonly CommitmentStatus[] = [
  'released_money',
  'released_credits',
  'forfeited',
  'auto_released',
  'refunded_on_cancel',
  'void',
];

/** Money currently held (counts against the cap; balances the `held` account). */
export const HOLDING: readonly CommitmentStatus[] = ['held', 'disputed'];

/**
 * Who may move a commitment from where to where. Anything absent is refused.
 * Admin may settle a disputed row any way, or put it back to `held`.
 */
const ALLOWED: Record<string, Partial<Record<CommitmentStatus, readonly Actor[]>>> = {
  pending_payment: { held: ['system'], void: ['system'], disputed: ['system'] },
  held: {
    released_money: ['service', 'admin'],
    released_credits: ['service', 'admin'],
    forfeited: ['service', 'admin'],
    refunded_on_cancel: ['service', 'admin'],
    disputed: ['service', 'admin'],
    auto_released: ['system'],
  },
  disputed: {
    held: ['admin'],
    released_money: ['admin'],
    released_credits: ['admin'],
    forfeited: ['admin'],
    refunded_on_cancel: ['admin'],
    auto_released: ['system'],
  },
};

export function mayTransition(from: CommitmentStatus, to: CommitmentStatus, actor: Actor): boolean {
  return (ALLOWED[from]?.[to] ?? []).includes(actor);
}

export interface LedgerLine {
  account: string;
  debit: Decimal;
  credit: Decimal;
}

const ZERO = new Decimal(0);
const dr = (account: string, amount: Decimal): LedgerLine => ({
  account,
  debit: amount,
  credit: ZERO,
});
const cr = (account: string, amount: Decimal): LedgerLine => ({
  account,
  debit: ZERO,
  credit: amount,
});

/** Where a cancel's money goes: back on the card, or to the INITE wallet. */
export type CancelRoute = 'card' | 'wallet';

/**
 * The double-entry lines for one transition. Debits always equal credits;
 * zero-amount lines are dropped (a zero fee writes nothing).
 */
export function ledgerFor(input: {
  from: CommitmentStatus;
  to: CommitmentStatus;
  stake: Decimal;
  fee: Decimal;
  charityCode: string;
  cancelRoute?: CancelRoute;
}): LedgerLine[] {
  const { from, to, stake, fee, charityCode } = input;
  let lines: LedgerLine[] = [];
  if (from === 'pending_payment' && to === 'held') {
    lines = [dr('payments_in', stake.plus(fee)), cr('held', stake), cr('fee_income', fee)];
  } else if (from === 'pending_payment' && to === 'disputed') {
    // Paid, but not the amount quoted: the money is held all the same, and an
    // admin decides. The fee is not booked as income until then.
    lines = [dr('payments_in', stake.plus(fee)), cr('held', stake), cr('fee_income', fee)];
  } else if (to === 'held' || to === 'disputed') {
    lines = []; // held ↔ disputed: the money does not move
  } else if (HOLDING.includes(from)) {
    switch (to) {
      case 'released_money':
      case 'auto_released':
        lines = [dr('held', stake), cr('owed_to_user', stake)];
        break;
      case 'released_credits':
        lines = [dr('held', stake), cr('credits_issued', stake)];
        break;
      case 'forfeited':
        lines = [dr('held', stake), cr(`charity_payable:${charityCode}`, stake)];
        break;
      case 'refunded_on_cancel': {
        const target = input.cancelRoute === 'card' ? 'refunded' : 'owed_to_user';
        lines = [dr('held', stake), dr('fee_income', fee), cr(target, stake.plus(fee))];
        break;
      }
      default:
        lines = [];
    }
  }
  return lines.filter((l) => !l.debit.isZero() || !l.credit.isZero());
}

export function isBalanced(lines: LedgerLine[]): boolean {
  const debits = lines.reduce((s, l) => s.plus(l.debit), ZERO);
  const credits = lines.reduce((s, l) => s.plus(l.credit), ZERO);
  return debits.equals(credits);
}

/** The outbox event a new state is announced with. */
export function eventFor(to: CommitmentStatus): string | null {
  switch (to) {
    case 'held':
      return 'billing.commitment.held';
    case 'released_money':
    case 'released_credits':
      return 'billing.commitment.released';
    case 'forfeited':
      return 'billing.commitment.forfeited';
    case 'refunded_on_cancel':
      return 'billing.commitment.refunded';
    case 'disputed':
      return 'billing.commitment.disputed';
    case 'auto_released':
      return 'billing.commitment.auto_released';
    case 'void':
      return 'billing.commitment.void';
    default:
      return null;
  }
}

/** The money a state owes back to the person's INITE wallet, if any. */
export function owesWallet(to: CommitmentStatus, cancelRoute?: CancelRoute): boolean {
  return (
    to === 'released_money' ||
    to === 'auto_released' ||
    (to === 'refunded_on_cancel' && cancelRoute !== 'card')
  );
}
