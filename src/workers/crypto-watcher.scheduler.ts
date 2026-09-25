import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/services/prisma.service';
import { DistributedLockService } from '../common/locks/distributed-lock.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { RAILS } from '../common/connectors/rail';
import { CryptoAdapter } from '../adapters/crypto/crypto.adapter';
import { CHAINS, CHAIN_IDS, ChainId } from '../adapters/crypto/chains';
import { loadCryptoSettings } from '../adapters/crypto/crypto-config';
import { watcherFor } from '../adapters/crypto/watchers';

/** How far before an invoice was opened to look, for clock skew between us and the chain's indexer. */
const LOOKBACK_SLACK_MS = 10 * 60 * 1000;

export interface ChainPollStatus {
  chain: ChainId;
  lastPolledAt: string | null;
  lastError: string | null;
  /** Transfers seen on the last successful poll. */
  transfersSeen: number;
  watching: boolean;
}

export interface PollReport {
  ranAt: string;
  expired: number;
  chains: ChainPollStatus[];
}

/**
 * Watches the chains for payments into the rail's wallets.
 *
 * Every 30 seconds, for each chain and token with an invoice that can still be
 * paid, it asks the chain's public API for recent incoming transfers and runs
 * each through the ledger. A transfer that moves an invoice forward becomes an
 * ordinary webhook event, so settlement goes through the same processor,
 * reconciliation and state machine as every other rail — this class decides
 * nothing about orders itself.
 *
 * It only polls chains that have something to wait for, so an idle shop makes
 * no calls at all. It also closes invoices whose deadline and grace period
 * have both passed, which is what releases their amounts and expires orders
 * nobody paid.
 */
@Injectable()
export class CryptoWatcherScheduler {
  private readonly logger = new Logger(CryptoWatcherScheduler.name);
  private readonly status = new Map<ChainId, ChainPollStatus>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: PaymentOrchestratorService,
    private readonly webhooks: WebhooksService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    await this.lock.runWithLock('crypto-watcher', 5 * 60_000, async () => {
      await this.poll();
    });
  }

  /**
   * Keep exchange rates fresh while the rail is on, so the first checkout of
   * the day is not the one that waits for a rate source.
   */
  @Cron('17 * * * *')
  async refreshRates(): Promise<void> {
    await this.lock.runWithLock('crypto-fx', 5 * 60_000, async () => {
      const settings = await loadCryptoSettings(this.prisma);
      const adapter = this.adapter();
      if (!settings?.isActive || !adapter) return;
      try {
        const { source, count } = await adapter.fx.refresh({ force: true });
        this.logger.log(`Exchange rates refreshed from ${source} (${count} currencies)`);
      } catch (error: any) {
        this.logger.warn(`Exchange rate refresh failed: ${error.message}`);
      }
    });
  }

  /** What the last polls found, per chain — for the admin page. */
  lastStatus(): ChainPollStatus[] {
    return CHAIN_IDS.map(
      (chain) =>
        this.status.get(chain) ?? {
          chain,
          lastPolledAt: null,
          lastError: null,
          transfersSeen: 0,
          watching: false,
        },
    );
  }

  private adapter(): CryptoAdapter | null {
    try {
      return this.orchestrator.getAdapter(RAILS.CRYPTO) as CryptoAdapter;
    } catch {
      return null;
    }
  }

  async poll(now = new Date()): Promise<PollReport> {
    const report: PollReport = { ranAt: now.toISOString(), expired: 0, chains: [] };
    const settings = await loadCryptoSettings(this.prisma);
    const adapter = this.adapter();
    if (!settings?.isActive || !adapter) return report;

    report.expired = await this.expire(adapter, now, settings.lateGraceHours);

    const targets = await adapter.ledger.watchList();
    const watched = new Set<ChainId>();

    for (const target of targets) {
      const chain = CHAINS[target.chain];
      const tokenInfo = chain?.tokens[target.token as keyof typeof chain.tokens];
      const watcher = chain ? watcherFor(target.chain, settings, { anyWallet: true }) : null;
      if (!chain || !tokenInfo || !watcher) {
        this.record(target.chain, {
          error: `No way to watch ${target.chain}: check its API settings`,
          seen: 0,
        });
        continue;
      }
      watched.add(target.chain);

      const since = new Date(target.since.getTime() - LOOKBACK_SLACK_MS);
      try {
        const transfers = await watcher.incoming({
          receiver: target.receiverAddress,
          token: target.token,
          contractAddress: tokenInfo.contractAddress,
          decimals: tokenInfo.decimals,
          requiredConfirmations: chain.confirmations,
          since,
          finalTxHashes: await adapter.ledger.finalTxHashes(target.chain, since),
        });

        for (const transfer of transfers) {
          const result = await adapter.ingest(transfer, 'watcher');
          if (!result.phase && !result.created) continue;
          const event = adapter.eventFor(result);
          await this.webhooks.storeWebhookEvent(
            RAILS.CRYPTO,
            event.webhookId as string,
            event.eventType,
            event.entityId,
            event.payload,
          );
        }
        this.record(target.chain, { error: null, seen: transfers.length });
      } catch (error: any) {
        // One chain's API being down must not stop the others being watched.
        this.logger.warn(
          `Crypto watcher: ${target.chain} ${target.token} poll failed: ${error.message}`,
        );
        this.record(target.chain, { error: error.message, seen: 0 });
      }
    }

    for (const chain of CHAIN_IDS) {
      const current = this.status.get(chain);
      if (current) current.watching = watched.has(chain);
    }
    report.chains = this.lastStatus();
    return report;
  }

  /**
   * Close invoices past deadline and grace, and expire the payment each one
   * was for — the transition that ends the order and gives back a promo code
   * it consumed. Only an intent still waiting for money: one a transfer has
   * reached is left for that transfer to settle.
   */
  private async expire(adapter: CryptoAdapter, now: Date, graceHours: number): Promise<number> {
    const expired = await adapter.ledger.expireStale(now, graceHours);
    for (const invoice of expired) {
      const intent = await this.prisma.paymentIntent.findFirst({
        where: { providerIntentId: invoice.invoiceId, rail: RAILS.CRYPTO, status: 'created' },
      });
      if (!intent) continue;
      try {
        await this.orchestrator.applyStateTransition(intent.id, 'expired');
      } catch (error: any) {
        this.logger.warn(`Could not expire crypto intent ${intent.id}: ${error.message}`);
      }
    }
    if (expired.length) this.logger.log(`Expired ${expired.length} unpaid crypto invoice(s)`);
    return expired.length;
  }

  private record(chain: ChainId, result: { error: string | null; seen: number }): void {
    const previous = this.status.get(chain);
    this.status.set(chain, {
      chain,
      lastPolledAt: new Date().toISOString(),
      lastError: result.error,
      transfersSeen: result.error ? (previous?.transfersSeen ?? 0) : result.seen,
      watching: true,
    });
  }
}
