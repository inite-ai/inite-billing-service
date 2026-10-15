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
import { Relayer } from '../adapters/crypto/x402/relayer';
import { Settlements } from '../adapters/crypto/x402/settlements';
import { CheckoutService } from './checkout.service';
import { checkoutLinkMatches } from './checkout-link';

export interface X402Reply {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

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
  private readonly settlements: Settlements;

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly config: ConfigService,
  ) {
    this.settlements = new Settlements(prisma);
  }

  /** Whether x402 can take payments now: a relayer, and the rail taking USDC on Base. */
  async available(): Promise<boolean> {
    return (await this.relayer()) !== null;
  }

  /** The address an agent pays a session at. The link token is what opens it, as on the checkout page. */
  urlFor(sessionId: string, linkToken: string): string {
    return `${resolveFrontendUrl(this.config)}/v1/x402/sessions/${sessionId}?t=${encodeURIComponent(linkToken)}`;
  }

  /** The relayer — null until the admin has filled in Turnkey and the rail takes Base. */
  private async relayer(): Promise<Relayer | null> {
    const settings = await loadCryptoSettings(this.prisma);
    if (!settings?.isActive || !payable(settings, X402_CHAIN)) return null;
    return this.settlements.relayer();
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
    const ours = await this.settlements.find(payment);
    return this.accepted(payment, orderId, ours?.txHash ?? null);
  }

  private async settle(
    relayer: Relayer,
    payment: DecodedPayment,
    orderId: string,
    invoiceId: string,
    required: (error?: string, reason?: string) => X402Reply,
  ): Promise<X402Reply> {
    const payer = payment.authorization.from.toLowerCase();

    // Claim the authorization first: a second request with the same header —
    // a retry, a replay — finds it taken and is told how the first one went.
    const claim = await this.settlements.claim(payment, { orderId, invoiceId });
    if (!claim.claimed) {
      const existing = claim.existing;
      if (existing?.txHash && existing.status !== 'reverted')
        return this.accepted(payment, orderId, existing.txHash);
      return json(409, { error: 'This payment is already being settled' });
    }

    let hash: `0x${string}`;
    try {
      hash = await this.settlements.submit(relayer, payment, claim.row.id);
    } catch (error: any) {
      if (error instanceof X402Error) return required(error.message, error.reason);
      this.logger.error(`x402 settlement for order ${orderId} failed: ${error?.message}`);
      return json(502, {
        error: 'The payment could not be submitted',
        errorReason: 'unexpected_settle_error',
      });
    }
    this.logger.log(`x402: order ${orderId} paid by ${payer}, tx ${hash}`);

    const mined = await this.settlements.confirm(relayer, hash, claim.row.id);
    if (mined === false) {
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
