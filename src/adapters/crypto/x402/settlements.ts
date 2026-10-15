import type { X402Payment } from '@prisma/client';
import { PrismaService } from '../../../common/services/prisma.service';
import { loadCryptoSettings } from '../crypto-config';
import { DecodedPayment, X402Error, X402_CHAIN } from './protocol';
import { Relayer, baseClient } from './relayer';
import { relayerSigner } from './signer';
import { RelayerKeys } from './relayer-key';

/** One relayer transaction at a time: its account nonce is read fresh for each. */
const RELAYER_LOCK = 402_402;
/** How long to wait for the transaction to land before answering. Base makes a block every 2 s. */
export const RECEIPT_WAIT_MS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What an authorization is for: an x402 payment of an order, or a wallet withdrawal. */
export type SettlementPurpose = { orderId: string; invoiceId: string } | { withdrawalId: string };

export type Claim =
  | { claimed: true; row: X402Payment }
  /** Someone already took this authorization on — a retry, a replay. */
  | { claimed: false; existing: X402Payment | null };

/**
 * Putting EIP-3009 USDC authorizations on chain through the relayer — for
 * x402 payments and for withdrawals from INITE wallets alike.
 *
 * Every authorization is claimed once by (payer, nonce) before anything is
 * sent; transactions go out one at a time under a lock; their fees come out
 * of one daily budget. A refusal before sending releases the claim; anything
 * that might have reached the network keeps it, so one authorization is never
 * sent twice.
 */
export class Settlements {
  private readonly keys: RelayerKeys;

  constructor(private readonly prisma: PrismaService) {
    this.keys = new RelayerKeys(prisma);
  }

  /**
   * The relayer, from the rail's settings and billing's own Turnkey key —
   * null until the admin has filled in Turnkey.
   */
  async relayer(): Promise<Relayer | null> {
    const settings = await loadCryptoSettings(this.prisma);
    if (!settings?.isActive) return null;
    const signer = relayerSigner(settings.x402, await this.keys.current());
    return signer ? new Relayer(signer, baseClient(settings.rpcUrls[X402_CHAIN])) : null;
  }

  async claim(payment: DecodedPayment, purpose: SettlementPurpose): Promise<Claim> {
    const a = payment.authorization;
    const payer = a.from.toLowerCase();
    try {
      const row = await this.prisma.x402Payment.create({
        data: {
          ...purpose,
          payer,
          nonce: a.nonce,
          valueRaw: a.value.toString(),
          validBefore: new Date(Number(a.validBefore) * 1000),
        },
      });
      return { claimed: true, row };
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      return { claimed: false, existing: await this.find(payment) };
    }
  }

  /** The claim on this authorization, if billing took it on. */
  find(payment: DecodedPayment): Promise<X402Payment | null> {
    return this.prisma.x402Payment.findUnique({
      where: {
        payer_nonce: {
          payer: payment.authorization.from.toLowerCase(),
          nonce: payment.authorization.nonce,
        },
      },
    });
  }

  /**
   * Send a claimed authorization. An {@link X402Error} means nothing was sent
   * and the claim is released; any other error leaves the claim `failed`.
   */
  async submit(relayer: Relayer, payment: DecodedPayment, claimId: string): Promise<`0x${string}`> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RELAYER_LOCK})`;
          const spent = await this.spentSince(new Date(Date.now() - DAY_MS));
          const sent = await relayer.send(payment, spent);
          await tx.x402Payment.update({
            where: { id: claimId },
            data: { status: 'submitted', txHash: sent.hash, feeWei: sent.maxCostWei.toString() },
          });
          return sent.hash;
        },
        { timeout: 45_000, maxWait: 30_000 },
      );
    } catch (error: any) {
      if (error instanceof X402Error) {
        // Refused before anything was sent: the authorization is still the
        // payer's, free to be used again once the reason is gone.
        await this.prisma.x402Payment.delete({ where: { id: claimId } }).catch(() => undefined);
      } else {
        // It may or may not have reached the network. Keep the claim.
        await this.prisma.x402Payment
          .update({
            where: { id: claimId },
            data: { status: 'failed', error: String(error?.message ?? error) },
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * Wait for the transaction and record what it cost. True mined, false
   * reverted, null still pending after the wait.
   */
  async confirm(relayer: Relayer, hash: `0x${string}`, claimId: string): Promise<boolean | null> {
    const receipt = await relayer.receipt(hash, RECEIPT_WAIT_MS);
    if (!receipt) return null;
    const ok = receipt.status === 'success';
    await this.prisma.x402Payment.update({
      where: { id: claimId },
      data: {
        status: ok ? 'mined' : 'reverted',
        feeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
      },
    });
    return ok;
  }

  private async spentSince(since: Date): Promise<bigint> {
    const rows = await this.prisma.x402Payment.findMany({
      where: { createdAt: { gte: since }, feeWei: { not: null } },
      select: { feeWei: true },
    });
    return rows.reduce((sum, row) => sum + BigInt(row.feeWei ?? '0'), 0n);
  }
}
