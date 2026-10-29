import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { toMoney } from '../common/money';
import { TransitionDeps, transitionCommitment } from './commitment-transition';

type Tx = Prisma.TransactionClient;

/**
 * The order-paid side of a commitment, called by the payment orchestrator in
 * the same transaction that marks the order paid: the stake becomes `held`
 * exactly when the money is in, or not at all.
 *
 * Returns whether the order pays for a commitment (the orchestrator skips the
 * affiliate commission for those: a deposit is not a sale).
 *
 * The amount paid is checked against the quote. A promo code or any other
 * change that made the order cheaper than stake + fee does not get a full
 * stake: what was paid is held, and the row goes to `disputed` for an admin.
 */
export async function holdCommitmentForOrder(
  order: { id: string; amount: Decimal | string | number },
  tx: Tx,
  deps: TransitionDeps,
): Promise<boolean> {
  const row = await tx.commitment.findUnique({ where: { orderId: order.id } });
  if (!row) return false;
  if (row.status !== 'pending_payment') return true;

  const paid = await tx.paymentIntent.findFirst({
    where: { orderId: order.id, status: 'paid' },
    orderBy: { updatedAt: 'desc' },
    select: { rail: true },
  });
  const amount = toMoney(order.amount);
  const expected = row.stakeAmount.plus(row.feeAmount);
  if (amount.gte(expected)) {
    await transitionCommitment(tx, deps, {
      commitmentId: row.id,
      to: 'held',
      actor: 'system',
      reason: 'order paid',
      idempotencyKey: `hold:${order.id}`,
      hold: { paidRail: paid?.rail ?? null },
    });
    return true;
  }
  if (amount.lte(0)) {
    // Nothing arrived (a 100% discount): there is no stake to hold.
    await transitionCommitment(tx, deps, {
      commitmentId: row.id,
      to: 'void',
      actor: 'system',
      reason: 'order fulfilled with no payment',
      idempotencyKey: `hold:${order.id}`,
    });
    return true;
  }
  // Short: hold what arrived, fee first, and let an admin decide.
  const fee = Decimal.min(row.feeAmount, amount);
  const stake = amount.minus(fee);
  await transitionCommitment(tx, deps, {
    commitmentId: row.id,
    to: 'disputed',
    actor: 'system',
    reason: `amount_mismatch: paid ${amount.toFixed(2)}, quoted ${expected.toFixed(2)}`,
    idempotencyKey: `hold:${order.id}`,
    hold: {
      paidRail: paid?.rail ?? null,
      stake: stake.gt(0) ? stake : amount,
      fee: stake.gt(0) ? fee : new Decimal(0),
    },
  });
  return true;
}

/** The order failed or expired: its unpaid commitment is void. */
export async function voidCommitmentForOrder(
  orderId: string,
  tx: Tx,
  deps: TransitionDeps,
): Promise<void> {
  const row = await tx.commitment.findUnique({ where: { orderId } });
  if (!row || row.status !== 'pending_payment') return;
  await transitionCommitment(tx, deps, {
    commitmentId: row.id,
    to: 'void',
    actor: 'system',
    reason: 'order failed or expired',
    idempotencyKey: `void:${orderId}`,
  });
}
