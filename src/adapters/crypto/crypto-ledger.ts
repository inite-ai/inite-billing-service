import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/services/prisma.service';
import { ChainId, receiverKey } from './chains';
import { IncomingTransfer } from './watchers/types';

/** Invoice states that still hold their amount and can still be paid. */
export const LIVE_INVOICE_STATUSES = ['awaiting', 'confirming'];

/**
 * How many distinct amounts one price can be split into. At 6 decimals the
 * offset stays under a cent, which is what the customer pays for being
 * recognisable without a memo.
 */
const OFFSET_STEPS = 9_999;
const RESERVE_ATTEMPTS = 8;

export type TransferSource = 'watcher' | 'webhook';

export interface ReserveInput {
  invoiceId: string;
  orderId?: string | null;
  chain: ChainId;
  token: string;
  receiverAddress: string;
  baseAmountRaw: string;
  decimals: number;
  memo?: string | null;
  expiresAt: Date;
}

export type Invoice = Prisma.CryptoInvoiceGetPayload<object>;
export type Transfer = Prisma.CryptoTransferGetPayload<object>;

export interface IngestResult {
  transfer: Transfer;
  invoice: Invoice | null;
  /**
   * Set when this observation moved an invoice forward — first seen, or now
   * final. Null when it changed nothing a payment state depends on, so the
   * caller need not raise an event for it.
   */
  phase: 'seen' | 'final' | null;
  /** First time this transfer was recorded. */
  created: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}

/**
 * The crypto rail's books: which amount each open invoice is waiting for, and
 * every transfer that has arrived at a watched wallet.
 *
 * A stablecoin transfer on Ethereum or TRON carries a sender, a receiver and
 * an amount — nothing else. With one receiving wallet, the amount is the only
 * thing that can say which order a payment is for, so every invoice asks for a
 * slightly different one and keeps it to itself until it is paid or can no
 * longer be. The database enforces that, not this class: two checkouts racing
 * for the same amount cannot both have it.
 */
export class CryptoLedger {
  constructor(private readonly prisma: PrismaService) {}

  /** Reserve a unique amount for a new invoice. */
  async reserve(input: ReserveInput): Promise<Invoice> {
    const key = receiverKey(input.chain, input.receiverAddress);
    const base = BigInt(input.baseAmountRaw);
    const step = 10n ** BigInt(Math.max(0, input.decimals - 6));

    for (let attempt = 0; attempt < RESERVE_ATTEMPTS; attempt++) {
      const live = await this.prisma.cryptoInvoice.findMany({
        where: {
          chain: input.chain,
          token: input.token,
          receiverKey: key,
          status: { in: LIVE_INVOICE_STATUSES },
        },
        select: { amountRaw: true },
      });
      const taken = new Set(live.map((row) => row.amountRaw));

      // A random starting point, so two checkouts for the same price at the
      // same moment rarely reach for the same offset and have to retry.
      const start = randomInt(1, OFFSET_STEPS + 1);
      let amountRaw: string | null = null;
      for (let i = 0; i < OFFSET_STEPS; i++) {
        const offset = BigInt(((start - 1 + i) % OFFSET_STEPS) + 1);
        const candidate = (base + offset * step).toString();
        if (!taken.has(candidate)) {
          amountRaw = candidate;
          break;
        }
      }
      if (!amountRaw) {
        throw new Error(
          `Every payable amount near ${input.baseAmountRaw} ${input.token} on ${input.chain} is held by an open invoice; try again once some expire`,
        );
      }

      try {
        return await this.prisma.cryptoInvoice.create({
          data: {
            invoiceId: input.invoiceId,
            orderId: input.orderId ?? null,
            chain: input.chain,
            token: input.token,
            receiverAddress: input.receiverAddress,
            receiverKey: key,
            baseAmountRaw: input.baseAmountRaw,
            amountRaw,
            decimals: input.decimals,
            memo: input.memo ?? null,
            expiresAt: input.expiresAt,
          },
        });
      } catch (error) {
        // Somebody else took this amount between the read and the insert.
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new Error('Could not reserve a unique payment amount; please try again');
  }

  findByInvoiceId(invoiceId: string): Promise<Invoice | null> {
    return this.prisma.cryptoInvoice.findUnique({ where: { invoiceId } });
  }

  /**
   * Record a transfer and settle what it pays for.
   *
   * Idempotent per (chain, tx, token): the same transfer reported again — by the
   * next poll, or by both the watcher and an indexer — only ever moves its
   * confirmations forward.
   */
  async ingest(
    observed: IncomingTransfer & { memo?: string | null },
    source: TransferSource,
  ): Promise<IngestResult> {
    const existing = await this.prisma.cryptoTransfer.findUnique({
      where: {
        chain_txHash_token: {
          chain: observed.chain,
          txHash: observed.txHash,
          token: observed.token,
        },
      },
    });
    if (existing) return this.advance(existing, observed);

    const key = receiverKey(observed.chain, observed.to);
    let invoice = await this.prisma.cryptoInvoice.findFirst({
      where: {
        chain: observed.chain,
        token: observed.token,
        receiverKey: key,
        amountRaw: observed.amountRaw,
        status: { in: LIVE_INVOICE_STATUSES },
      },
    });

    // An indexer on a chain with memos (TON comments) may name the invoice
    // outright. Then any amount at least the invoiced one pays it.
    if (!invoice && observed.memo) {
      const byMemo = await this.prisma.cryptoInvoice.findFirst({
        where: {
          chain: observed.chain,
          token: observed.token,
          receiverKey: key,
          memo: observed.memo,
          status: { in: LIVE_INVOICE_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (byMemo && BigInt(observed.amountRaw) >= BigInt(byMemo.amountRaw)) invoice = byMemo;
    }

    let note: string | null = null;
    if (invoice) {
      // Claim the invoice for this transaction. Conditional, so two different
      // transfers of the same amount cannot both settle one invoice.
      const claimed = await this.prisma.cryptoInvoice.updateMany({
        where: { id: invoice.id, OR: [{ txHash: null }, { txHash: observed.txHash }] },
        data: {
          txHash: observed.txHash,
          confirmations: observed.confirmations,
          status: observed.isFinal ? 'paid' : 'confirming',
          paidAt: observed.isFinal ? new Date() : null,
        },
      });
      if (claimed.count === 0) {
        note = 'The invoice this amount matches was already paid by another transfer';
        invoice = null;
      }
    }

    const suggestion = invoice ? null : await this.suggest(observed, key);
    try {
      const transfer = await this.prisma.cryptoTransfer.create({
        data: {
          chain: observed.chain,
          txHash: observed.txHash,
          token: observed.token,
          fromAddress: observed.from ?? null,
          toAddress: observed.to,
          amountRaw: observed.amountRaw,
          decimals: observed.decimals,
          confirmations: observed.confirmations,
          isFinal: observed.isFinal,
          blockTime: observed.blockTime ?? null,
          source,
          status: invoice ? 'matched' : 'unmatched',
          invoiceId: invoice?.id ?? null,
          suggestedInvoiceId: suggestion?.id ?? null,
          note: note ?? (suggestion ? suggestion.reason : null),
        },
      });
      const settled = invoice
        ? await this.prisma.cryptoInvoice.findUnique({ where: { id: invoice.id } })
        : null;
      return {
        transfer,
        invoice: settled,
        phase: settled ? (observed.isFinal ? 'final' : 'seen') : null,
        created: true,
      };
    } catch (error) {
      // The same transfer reported twice at once: the other report won.
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.cryptoTransfer.findUnique({
        where: {
          chain_txHash_token: {
            chain: observed.chain,
            txHash: observed.txHash,
            token: observed.token,
          },
        },
      });
      if (!winner) throw error;
      return this.advance(winner, observed);
    }
  }

  private async advance(existing: Transfer, observed: IncomingTransfer): Promise<IngestResult> {
    const becameFinal = !existing.isFinal && observed.isFinal;
    const deeper = observed.confirmations > existing.confirmations;

    const transfer =
      becameFinal || deeper
        ? await this.prisma.cryptoTransfer.update({
            where: { id: existing.id },
            data: {
              confirmations: Math.max(existing.confirmations, observed.confirmations),
              isFinal: existing.isFinal || observed.isFinal,
            },
          })
        : existing;

    if (!transfer.invoiceId) return { transfer, invoice: null, phase: null, created: false };

    let invoice = await this.prisma.cryptoInvoice.findUnique({ where: { id: transfer.invoiceId } });
    if (invoice && (becameFinal || deeper) && invoice.txHash === transfer.txHash) {
      invoice = await this.prisma.cryptoInvoice.update({
        where: { id: invoice.id },
        data: {
          confirmations: transfer.confirmations,
          ...(becameFinal ? { status: 'paid', paidAt: new Date() } : {}),
        },
      });
    }
    return { transfer, invoice, phase: becameFinal ? 'final' : null, created: false };
  }

  /**
   * For a transfer no live invoice claims, the invoice it most likely was for:
   * one that asked for exactly this amount and has since expired or been
   * replaced, or one whose price is exactly what was sent — the customer who
   * paid the round number instead of the one on screen.
   */
  private async suggest(
    observed: IncomingTransfer,
    key: string,
  ): Promise<{ id: string; reason: string } | null> {
    const late = await this.prisma.cryptoInvoice.findFirst({
      where: {
        chain: observed.chain,
        token: observed.token,
        receiverKey: key,
        amountRaw: observed.amountRaw,
        status: { in: ['expired', 'cancelled'] },
        txHash: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (late) {
      return {
        id: late.id,
        reason: `Exact amount of an invoice that was ${late.status} before it was paid`,
      };
    }

    const roundNumber = await this.prisma.cryptoInvoice.findFirst({
      where: {
        chain: observed.chain,
        token: observed.token,
        receiverKey: key,
        baseAmountRaw: observed.amountRaw,
        txHash: null,
        status: { in: [...LIVE_INVOICE_STATUSES, 'expired', 'cancelled'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (roundNumber) {
      return {
        id: roundNumber.id,
        reason: 'The price without the identifying offset — the customer sent the round amount',
      };
    }
    return null;
  }

  /** Give an unpaid invoice's amount back — the customer chose another network or a new invoice. */
  async cancel(invoiceId: string): Promise<boolean> {
    const result = await this.prisma.cryptoInvoice.updateMany({
      where: { invoiceId, status: 'awaiting', txHash: null },
      data: { status: 'cancelled' },
    });
    return result.count > 0;
  }

  /**
   * Invoices whose deadline and grace have both passed with nothing received.
   * Each is closed individually and conditionally, so an invoice a transfer
   * claimed in the meantime is left alone.
   */
  async expireStale(now: Date, graceHours: number): Promise<Invoice[]> {
    const cutoff = new Date(now.getTime() - graceHours * 60 * 60 * 1000);
    const stale = await this.prisma.cryptoInvoice.findMany({
      where: { status: 'awaiting', txHash: null, expiresAt: { lt: cutoff } },
      take: 200,
    });
    const expired: Invoice[] = [];
    for (const invoice of stale) {
      const result = await this.prisma.cryptoInvoice.updateMany({
        where: { id: invoice.id, status: 'awaiting', txHash: null },
        data: { status: 'expired' },
      });
      if (result.count > 0) expired.push({ ...invoice, status: 'expired' });
    }
    return expired;
  }

  /** What the watcher should look for: chains and tokens with an invoice that can still be paid. */
  async watchList(): Promise<
    Array<{ chain: ChainId; token: string; receiverAddress: string; since: Date }>
  > {
    const rows = await this.prisma.cryptoInvoice.groupBy({
      by: ['chain', 'token', 'receiverAddress'],
      where: { status: { in: LIVE_INVOICE_STATUSES } },
      _min: { createdAt: true },
    });
    return rows.map((row) => ({
      chain: row.chain as ChainId,
      token: row.token,
      receiverAddress: row.receiverAddress,
      since: row._min.createdAt ?? new Date(),
    }));
  }

  async finalTxHashes(chain: ChainId, since: Date): Promise<Set<string>> {
    const rows = await this.prisma.cryptoTransfer.findMany({
      where: { chain, isFinal: true, createdAt: { gte: since } },
      select: { txHash: true },
    });
    return new Set(rows.map((row) => row.txHash));
  }

  /**
   * An admin attributes an unmatched transfer to an invoice — after checking
   * on the explorer that it is the customer's payment.
   */
  async assign(transferId: string, invoiceRowId: string, by: string, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.cryptoTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new LedgerError('not_found', `Transfer not found: ${transferId}`);
      if (transfer.status !== 'unmatched') {
        throw new LedgerError('conflict', `This transfer is already ${transfer.status}`);
      }
      const invoice = await tx.cryptoInvoice.findUnique({ where: { id: invoiceRowId } });
      if (!invoice) throw new LedgerError('not_found', `Invoice not found: ${invoiceRowId}`);
      if (invoice.chain !== transfer.chain || invoice.token !== transfer.token) {
        throw new LedgerError(
          'invalid',
          `The transfer is ${transfer.token} on ${transfer.chain}; the invoice asked for ${invoice.token} on ${invoice.chain}`,
        );
      }
      if (invoice.txHash || invoice.status === 'paid') {
        throw new LedgerError('conflict', 'That invoice is already paid');
      }

      const settled = await tx.cryptoInvoice.update({
        where: { id: invoice.id },
        data: {
          txHash: transfer.txHash,
          confirmations: transfer.confirmations,
          status: transfer.isFinal ? 'paid' : 'confirming',
          paidAt: transfer.isFinal ? new Date() : null,
        },
      });
      const matched = await tx.cryptoTransfer.update({
        where: { id: transfer.id },
        data: {
          status: 'matched',
          invoiceId: invoice.id,
          resolvedBy: by,
          note: note ?? transfer.note,
        },
      });
      return { transfer: matched, invoice: settled };
    });
  }

  /** An admin sets aside a transfer that pays for nothing here — refunded by hand, a test, a gift. */
  async ignore(transferId: string, by: string, note: string) {
    const transfer = await this.prisma.cryptoTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new LedgerError('not_found', `Transfer not found: ${transferId}`);
    if (transfer.status !== 'unmatched') {
      throw new LedgerError('conflict', `This transfer is already ${transfer.status}`);
    }
    return this.prisma.cryptoTransfer.update({
      where: { id: transferId },
      data: { status: 'ignored', resolvedBy: by, note },
    });
  }
}

export class LedgerError extends Error {
  constructor(
    readonly kind: 'not_found' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}
