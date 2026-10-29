import { createHash } from 'node:crypto';
import type { Charity, Commitment } from '@prisma/client';

export type CommitmentRow = Commitment & { charity: Charity };

export interface PayoutView {
  status: string;
  txHash: string | null;
}

/** The wire shape of a commitment (CONTRACT: CommitmentDto). */
export function commitmentView(row: CommitmentRow, payout?: PayoutView | null) {
  const verification = (row.verification ?? {}) as { referee?: boolean; proof?: boolean };
  return {
    id: row.id,
    externalRef: row.externalRef,
    userId: row.userId,
    orderId: row.orderId,
    productCode: row.productCode,
    status: row.status,
    stake: row.stakeAmount.toFixed(2),
    fee: row.feeAmount.toFixed(2),
    total: row.stakeAmount.plus(row.feeAmount).toFixed(2),
    currency: row.currency,
    charity: { code: row.charity.code, name: row.charity.name },
    verification: { referee: !!verification.referee, proof: !!verification.proof },
    endsAt: row.endsAt.toISOString(),
    autoReleaseAt: row.autoReleaseAt.toISOString(),
    cancelUntil: row.cancelUntil?.toISOString() ?? null,
    heldAt: row.heldAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    releaseAs: row.releaseAs,
    credits: row.creditsGranted,
    payout:
      row.payoutState === 'none'
        ? null
        : payout
          ? { status: payout.status, txHash: payout.txHash }
          : { status: row.payoutState, txHash: null },
  };
}

/** A short public reference for a commitment: never the id, never the person. */
export function publicRef(id: string): string {
  return createHash('sha256').update(`commitment:${id}`).digest('hex').slice(0, 10);
}
