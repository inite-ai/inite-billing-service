import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/services/prisma.service';
import { DistributedLockService } from '../common/locks/distributed-lock.service';
import { OutboxService } from '../outbox/outbox.service';
import { CreditsService } from '../credits/credits.service';
import { TreasuryService } from '../wallet/treasury.service';
import { backstopAt, readPolicy } from './commitment-policy';
import { transitionCommitment } from './commitment-transition';

const BATCH = 50;

/**
 * The clock's side of commitments, on one instance at a time:
 * - a held stake with no verdict by `auto_release_at` (end + 7 days) goes
 *   back to the person;
 * - a disputed one an admin never decided goes back at the backstop
 *   (end + 30 days);
 * - money owed to a person's INITE wallet is paid from the treasury once
 *   the wallet exists, and booked paid once the chain says it is mined.
 */
@Injectable()
export class CommitmentScheduler {
  private readonly logger = new Logger(CommitmentScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: DistributedLockService,
    private readonly outbox: OutboxService,
    private readonly credits: CreditsService,
    private readonly treasury: TreasuryService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    await this.lock.runWithLock('commitments', 10 * 60_000, async () => {
      await this.autoRelease();
      await this.payOwed();
    });
  }

  async autoRelease(now = new Date()): Promise<number> {
    let moved = 0;
    const due = await this.prisma.commitment.findMany({
      where: { status: 'held', autoReleaseAt: { lte: now } },
      select: { id: true },
      take: BATCH,
    });
    const disputed = await this.prisma.commitment.findMany({
      where: { status: 'disputed', endsAt: { lte: now } },
      select: { id: true, endsAt: true, productCode: true },
      take: BATCH,
    });
    const policies = new Map<string, ReturnType<typeof readPolicy>>();
    for (const d of disputed) {
      if (!policies.has(d.productCode)) {
        const p = await this.prisma.product.findUnique({ where: { code: d.productCode } });
        policies.set(d.productCode, readPolicy(p?.metadata));
      }
      const policy = policies.get(d.productCode);
      if (policy && backstopAt(policy, d.endsAt) <= now) due.push({ id: d.id });
    }
    for (const { id } of due) {
      try {
        const r = await this.prisma.$transaction((tx) =>
          transitionCommitment(
            tx,
            { outbox: this.outbox, credits: this.credits },
            {
              commitmentId: id,
              to: 'auto_released',
              actor: 'system',
              reason: 'no verdict in time',
              idempotencyKey: `auto:${id}`,
            },
          ),
        );
        if (r.changed) moved++;
      } catch (error: any) {
        this.logger.warn(`Auto-release of ${id} failed: ${error?.message}`);
      }
    }
    return moved;
  }

  /**
   * Pay what is owed to wallets. One treasury payout per stake order (the
   * treasury makes it exactly once); the ledger books it paid when mined.
   */
  async payOwed(): Promise<void> {
    const owed = await this.prisma.commitment.findMany({
      where: { payoutState: { in: ['awaiting_wallet', 'queued'] } },
      take: BATCH,
    });
    for (const row of owed) {
      try {
        const existing = await this.prisma.treasuryPayout.findUnique({
          where: { orderId: row.orderId },
        });
        if (existing) {
          if (existing.status === 'mined') await this.bookPaid(row.id, existing.id);
          continue;
        }
        const wallet = await this.prisma.wallet.findUnique({ where: { ownerDid: row.userId } });
        if (!wallet || wallet.ownerKey) continue; // no INITE wallet yet: wait for it
        const amount =
          row.status === 'refunded_on_cancel'
            ? row.stakeAmount.plus(row.feeAmount)
            : row.stakeAmount;
        const payout = await this.treasury.payOrderToWallet(
          row.orderId,
          wallet.address,
          amount.toFixed(2),
        );
        if (!payout) continue; // no treasury yet
        await this.prisma.commitment.update({
          where: { id: row.id },
          data: { payoutState: 'queued' },
        });
        if (payout.status === 'mined') await this.bookPaid(row.id, payout.id);
      } catch (error: any) {
        this.logger.warn(`Payout for commitment ${row.id} not made yet: ${error?.message}`);
      }
    }
  }

  /** Dr owed_to_user / Cr paid_to_user, once per payout. */
  private async bookPaid(commitmentId: string, payoutId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing.commitments WHERE id = ${commitmentId}::uuid FOR UPDATE`;
      const row = await tx.commitment.findUniqueOrThrow({ where: { id: commitmentId } });
      if (row.payoutState === 'sent') return;
      const amount =
        row.status === 'refunded_on_cancel' ? row.stakeAmount.plus(row.feeAmount) : row.stakeAmount;
      await tx.commitmentLedgerEntry.createMany({
        data: [
          {
            commitmentId,
            payoutId,
            account: 'owed_to_user',
            debit: amount,
            credit: 0,
            currency: row.currency,
          },
          {
            commitmentId,
            payoutId,
            account: 'paid_to_user',
            debit: 0,
            credit: amount,
            currency: row.currency,
          },
        ],
      });
      await tx.commitment.update({ where: { id: commitmentId }, data: { payoutState: 'sent' } });
    });
  }
}
