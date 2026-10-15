import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/services/prisma.service';
import { resolveFrontendUrl } from '../common/config/frontend-url';
import { loadCryptoSettings, payable } from '../adapters/crypto/crypto-config';
import {
  DecodedPayment,
  X402Error,
  X402Invoice,
  X402_CHAIN,
  X402_HEADERS,
  X402_TOKEN,
  checkAuthorization,
  decodePayment,
  encodeHeader,
  paymentRequired,
  paymentRequiredV1,
  settlementResponse,
} from '../adapters/crypto/x402/protocol';
import { Relayer, baseClient } from '../adapters/crypto/x402/relayer';
import { RelayerSigner, signerFromEnv } from '../adapters/crypto/x402/signer';
import { CheckoutService } from './checkout.service';
import { checkoutLinkMatches } from './checkout-link';

export interface X402Reply {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** One relayer transaction at a time: its account nonce is read fresh for each. */
const RELAYER_LOCK = 402_402;
/** How long to wait for the transaction to land before answering. Base makes a block every 2 s. */
const RECEIPT_WAIT_MS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const PAID_STATUSES = ['paid', 'completed', 'fulfilled'];

/**
 * x402 for checkout sessions: an agent pays an order with a signed USDC
 * authorization on Base.
 *
 * Nothing here settles an order. The session gets an ordinary crypto-rail
 * invoice (Base, USDC, our wallet, a unique amount); the agent's authorization
 * must be for exactly that invoice; we put it on chain; the crypto watcher
 * sees the transfer and the order is paid through the same processor as any
 * other crypto payment, once the transfer is final. So the wallet, the
 * ledger, the confirmations and the admin view are the rail's, not a second
 * set kept for agents.
 */
@Injectable()
export class X402Service {
  private readonly logger = new Logger(X402Service.name);
  private readonly signer: RelayerSigner | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly config: ConfigService,
  ) {
    this.signer = signerFromEnv();
  }

  /** Whether x402 can take payments now: a relayer, and the rail taking USDC on Base. */
  async available(): Promise<boolean> {
    if (!this.signer) return false;
    const settings = await loadCryptoSettings(this.prisma);
    return !!settings?.isActive && payable(settings, X402_CHAIN);
  }

  /** The address an agent pays a session at. The link token is what opens it, as on the checkout page. */
  urlFor(sessionId: string, linkToken: string): string {
    return `${resolveFrontendUrl(this.config)}/v1/x402/sessions/${sessionId}?t=${encodeURIComponent(linkToken)}`;
  }

  private async relayer(): Promise<Relayer | null> {
    if (!this.signer) return null;
    const settings = await loadCryptoSettings(this.prisma);
    if (!settings?.isActive || !payable(settings, X402_CHAIN)) return null;
    return new Relayer(this.signer, baseClient(settings.rpcUrls[X402_CHAIN]));
  }

  async handle(
    sessionId: string,
    linkToken: string | undefined,
    headers: Record<string, string | string[] | undefined>,
    resourceUrl: string,
  ): Promise<X402Reply> {
    const relayer = await this.relayer();
    if (!relayer) return json(404, { error: 'x402 payments are not available' });

    const order = await this.prisma.order.findUnique({
      where: { id: sessionId },
      include: { price: { include: { product: true } } },
    });
    if (!order || !linkToken || !checkoutLinkMatches(order.metadata, linkToken)) {
      return json(404, { error: 'Checkout session not found' });
    }
    if (PAID_STATUSES.includes(order.status)) {
      return json(200, { status: 'paid', orderId: order.id });
    }
    if (order.status !== 'created') {
      return json(409, { error: `The order is ${order.status}` });
    }

    // The session's invoice on Base: the live one, or a new one.
    const pay: Record<string, any> = await this.checkout.paySession(
      sessionId,
      undefined,
      { rail: 'CRYPTO', cryptoChain: X402_CHAIN, cryptoToken: X402_TOKEN },
      undefined,
      linkToken,
    );
    const payment = pay.payment;
    if (!payment) return json(502, { error: 'No invoice could be opened for this order' });
    if (payment.chain !== X402_CHAIN || payment.token !== X402_TOKEN) {
      return json(409, { error: 'This order is already being paid another way' });
    }
    if (payment.txHash) {
      return json(200, { status: 'confirming', orderId: order.id, transaction: payment.txHash });
    }
    const invoice: X402Invoice & { invoiceId: string } = {
      invoiceId: String(payment.invoiceId),
      amountRaw: String(payment.amountRaw),
      receiverAddress: String(payment.address),
      expiresAt: new Date(payment.expiresAt),
    };
    const resource = {
      url: resourceUrl,
      description: `${order.price.product.name} — ${payment.amount} USDC`,
    };
    const required = (error?: string, reason?: string): X402Reply => ({
      status: 402,
      headers: {
        [X402_HEADERS.required]: encodeHeader(
          paymentRequired(invoice, resource, new Date(), error),
        ),
      },
      body: {
        ...paymentRequiredV1(invoice, resource, new Date(), error),
        ...(reason ? { errorReason: reason } : {}),
      },
    });

    let decoded: DecodedPayment | null;
    try {
      decoded = decodePayment(headers);
    } catch (error) {
      if (error instanceof X402Error)
        return json(400, { error: error.message, errorReason: error.reason });
      throw error;
    }
    if (!decoded) return required();

    try {
      checkAuthorization(decoded, invoice);
      await relayer.verify(decoded);
    } catch (error) {
      if (!(error instanceof X402Error)) throw error;
      if (error.reason === 'authorization_used') return this.alreadyUsed(decoded, order.id);
      return required(error.message, error.reason);
    }

    return this.settle(relayer, decoded, order.id, invoice.invoiceId, required);
  }

  /**
   * The authorization is spent on chain. Ours: report the transaction we sent.
   * Someone else's — whoever saw the header and submitted it first — still
   * moved the money to our wallet, and the watcher will match it to the invoice.
   */
  private async alreadyUsed(payment: DecodedPayment, orderId: string): Promise<X402Reply> {
    const ours = await this.prisma.x402Payment.findUnique({
      where: {
        payer_nonce: {
          payer: payment.authorization.from.toLowerCase(),
          nonce: payment.authorization.nonce,
        },
      },
    });
    return this.accepted(payment, orderId, ours?.txHash ?? null);
  }

  private async settle(
    relayer: Relayer,
    payment: DecodedPayment,
    orderId: string,
    invoiceId: string,
    required: (error?: string, reason?: string) => X402Reply,
  ): Promise<X402Reply> {
    const a = payment.authorization;
    const payer = a.from.toLowerCase();

    // Claim the authorization first: a second request with the same header —
    // a retry, a replay — finds it taken and is told how the first one went.
    let claim;
    try {
      claim = await this.prisma.x402Payment.create({
        data: {
          orderId,
          invoiceId,
          payer,
          nonce: a.nonce,
          valueRaw: a.value.toString(),
          validBefore: new Date(Number(a.validBefore) * 1000),
        },
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const existing = await this.prisma.x402Payment.findUnique({
        where: { payer_nonce: { payer, nonce: a.nonce } },
      });
      if (existing?.txHash && existing.status !== 'reverted')
        return this.accepted(payment, orderId, existing.txHash);
      return json(409, { error: 'This payment is already being settled' });
    }

    let hash: `0x${string}`;
    try {
      hash = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RELAYER_LOCK})`;
          const spent = await this.spentSince(new Date(Date.now() - DAY_MS));
          const sent = await relayer.send(payment, spent);
          await tx.x402Payment.update({
            where: { id: claim.id },
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
        await this.prisma.x402Payment.delete({ where: { id: claim.id } }).catch(() => undefined);
        return required(error.message, error.reason);
      }
      // It may or may not have reached the network. Keep the claim — never
      // risk sending one authorization twice — and let the watcher tell.
      this.logger.error(`x402 settlement for order ${orderId} failed: ${error?.message}`);
      await this.prisma.x402Payment
        .update({
          where: { id: claim.id },
          data: { status: 'failed', error: String(error?.message ?? error) },
        })
        .catch(() => undefined);
      return json(502, {
        error: 'The payment could not be submitted',
        errorReason: 'unexpected_settle_error',
      });
    }
    this.logger.log(`x402: order ${orderId} paid by ${payer}, tx ${hash}`);

    const receipt = await relayer.receipt(hash, RECEIPT_WAIT_MS);
    if (receipt) {
      const fee = receipt.gasUsed * receipt.effectiveGasPrice;
      const ok = receipt.status === 'success';
      await this.prisma.x402Payment.update({
        where: { id: claim.id },
        data: { status: ok ? 'mined' : 'reverted', feeWei: fee.toString() },
      });
      if (!ok) {
        this.logger.error(`x402 tx ${hash} for order ${orderId} reverted`);
        return {
          ...required('The transfer was refused on chain', 'settlement_reverted'),
          headers: {
            ...required().headers,
            ...responseHeaders(payment, {
              success: false,
              transaction: hash,
              errorReason: 'settlement_reverted',
            }),
          },
        };
      }
    }
    return this.accepted(payment, orderId, hash);
  }

  private accepted(
    payment: DecodedPayment,
    orderId: string,
    transaction: string | null,
  ): X402Reply {
    return {
      status: 200,
      headers: responseHeaders(payment, { success: true, transaction }),
      body: {
        status: 'confirming',
        orderId,
        transaction,
        message:
          'Paid. The order completes once the transfer is final on Base, usually within two minutes; this URL then answers status "paid".',
      },
    };
  }

  private async spentSince(since: Date): Promise<bigint> {
    const rows = await this.prisma.x402Payment.findMany({
      where: { createdAt: { gte: since }, feeWei: { not: null } },
      select: { feeWei: true },
    });
    return rows.reduce((sum, row) => sum + BigInt(row.feeWei ?? '0'), 0n);
  }
}

function json(status: number, body: unknown): X402Reply {
  return { status, headers: {}, body };
}

function responseHeaders(
  payment: DecodedPayment,
  input: { success: boolean; transaction: string | null; errorReason?: string },
): Record<string, string> {
  const value = encodeHeader(
    settlementResponse({
      ...input,
      payer: payment.authorization.from,
      amount: payment.authorization.value.toString(),
      version: payment.version,
    }),
  );
  return payment.version === 2
    ? { [X402_HEADERS.response]: value }
    : { [X402_HEADERS.v1Response]: value };
}
