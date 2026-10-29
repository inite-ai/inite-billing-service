import type { Commitment, CommitmentStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CommitmentError } from './commitment-policy';
import {
  Actor,
  CancelRoute,
  SETTLED,
  eventFor,
  isBalanced,
  ledgerFor,
  mayTransition,
  owesWallet,
} from './commitment-states';

type Tx = Prisma.TransactionClient;

export interface TransitionDeps {
  outbox: {
    emit(
      eventType: string,
      payload: Record<string, any>,
      options: { serviceId?: string | null; tx?: any },
    ): Promise<void>;
  };
  credits?: {
    grant(
      data: {
        userId: string;
        serviceId?: string;
        amount: number;
        description?: string;
        orderId?: string;
      },
      tx?: Tx,
    ): Promise<unknown>;
  };
}

export interface TransitionInput {
  commitmentId: string;
  to: CommitmentStatus;
  actor: Actor;
  actorId?: string | null;
  reason?: string | null;
  idempotencyKey: string;
  cancelRoute?: CancelRoute;
  /** Rules that depend on the locked row (time windows): throw to refuse. */
  check?: (row: Commitment) => void | Promise<void>;
  /** Set at hold: the rail that paid, and amounts corrected to what was paid. */
  hold?: { paidRail?: string | null; stake?: Decimal; fee?: Decimal };
}

export interface TransitionResult {
  commitment: Commitment;
  changed: boolean;
}

/**
 * Move one commitment, in the caller's transaction: lock the row, check the
 * move is allowed for this actor, then write the journal line, the balanced
 * ledger lines, the new state, any credit grant and the outbox event — all or
 * nothing.
 *
 * Idempotent twice over: a key already used on this commitment returns the
 * row as it is (and refuses if that key moved it somewhere else), and a move
 * to the state it is already in changes nothing.
 */
export async function transitionCommitment(
  tx: Tx,
  deps: TransitionDeps,
  input: TransitionInput,
): Promise<TransitionResult> {
  await tx.$queryRaw`SELECT id FROM billing.commitments WHERE id = ${input.commitmentId}::uuid FOR UPDATE`;
  const row = await tx.commitment.findUnique({
    where: { id: input.commitmentId },
    include: { charity: true },
  });
  if (!row) throw new CommitmentError('not_found', 'No such commitment');

  const seen = await tx.commitmentTransition.findUnique({
    where: {
      commitmentId_idempotencyKey: {
        commitmentId: row.id,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (seen) {
    if (seen.toStatus !== input.to) {
      throw new CommitmentError(
        'idempotency_key_reused',
        'This idempotency key already moved the commitment elsewhere',
      );
    }
    return { commitment: row, changed: false };
  }
  if (row.status === input.to) return { commitment: row, changed: false };
  if (!mayTransition(row.status, input.to, input.actor)) {
    throw new CommitmentError(
      'invalid_state',
      `A commitment in ${row.status} cannot become ${input.to}`,
    );
  }
  if (input.check) await input.check(row);

  const stake = input.hold?.stake ?? row.stakeAmount;
  const fee = input.hold?.fee ?? row.feeAmount;
  const lines = ledgerFor({
    from: row.status,
    to: input.to,
    stake,
    fee,
    charityCode: row.charity.code,
    cancelRoute: input.cancelRoute,
  });
  if (!isBalanced(lines)) throw new Error(`Unbalanced ledger for ${row.id} → ${input.to}`);

  const transition = await tx.commitmentTransition.create({
    data: {
      commitmentId: row.id,
      fromStatus: row.status,
      toStatus: input.to,
      actor: input.actor,
      actorId: input.actorId ?? null,
      reason: input.reason?.slice(0, 2000) ?? null,
      idempotencyKey: input.idempotencyKey,
    },
  });
  if (lines.length > 0) {
    await tx.commitmentLedgerEntry.createMany({
      data: lines.map((l) => ({
        commitmentId: row.id,
        transitionId: transition.id,
        account: l.account,
        debit: l.debit,
        credit: l.credit,
        currency: row.currency,
      })),
    });
  }

  let creditsGranted: number | undefined;
  if (input.to === 'released_credits') {
    if (!deps.credits) throw new Error('Credits are not wired for commitments');
    creditsGranted = stake
      .mul(row.creditsPerUsd)
      .mul(new Decimal(100).plus(row.creditsBonusPct))
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_FLOOR)
      .toNumber();
    if (creditsGranted <= 0) {
      throw new CommitmentError('invalid_state', 'This stake offer has no credits option');
    }
    await deps.credits.grant(
      {
        userId: row.userId,
        ...(row.creditsServiceId ? { serviceId: row.creditsServiceId } : {}),
        amount: creditsGranted,
        description: `Stake kept: commitment ${row.id}`,
        orderId: row.orderId,
      },
      tx,
    );
  }

  const now = new Date();
  const releaseAs =
    input.to === 'released_credits'
      ? 'credits'
      : input.to === 'released_money' || input.to === 'auto_released'
        ? 'money'
        : undefined;
  const updated = await tx.commitment.update({
    where: { id: row.id },
    data: {
      status: input.to,
      version: { increment: 1 },
      ...(input.hold
        ? {
            heldAt: now,
            paidRail: input.hold.paidRail ?? null,
            stakeAmount: stake,
            feeAmount: fee,
          }
        : {}),
      ...(SETTLED.includes(input.to) ? { settledAt: now } : {}),
      ...(releaseAs ? { releaseAs } : {}),
      ...(creditsGranted !== undefined ? { creditsGranted } : {}),
      ...(owesWallet(input.to, input.cancelRoute) ? { payoutState: 'awaiting_wallet' } : {}),
    },
    include: { charity: true },
  });

  const event = eventFor(input.to);
  if (event) {
    await deps.outbox.emit(
      event,
      {
        commitment_id: updated.id,
        external_ref: updated.externalRef,
        user_id: updated.userId,
        status: updated.status,
        previous_status: row.status,
        stake: updated.stakeAmount.toFixed(2),
        fee: updated.feeAmount.toFixed(2),
        currency: updated.currency,
        release_as: updated.releaseAs,
        charity: updated.charity.code,
      },
      { serviceId: updated.serviceId, tx },
    );
  }
  return { commitment: updated, changed: true };
}
