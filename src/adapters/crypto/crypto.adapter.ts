import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  Connector,
  ConnectorCapabilities,
  RegisterConnector,
  WebhookVerifyInput,
} from '../../common/connectors/connector.interface';
import { safeTimingSafeEqual } from '../../common/connectors/webhook-verify.util';
import { RAILS } from '../../common/connectors/rail';
import {
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
  PaymentMethod,
  WebhookParseResult,
} from '../../common/interfaces/payment-rail-adapter.interface';
import { PrismaService } from '../../common/services/prisma.service';
import { formatUnits, parseRawAmount, toOnChainAmount } from './amount.util';
import {
  CHAINS,
  CHAIN_IDS,
  ChainId,
  STABLECOIN_CURRENCIES,
  isChainId,
  paymentUri,
  receiverKey,
  txExplorerUrl,
} from './chains';
import { CryptoSettings, loadCryptoSettings, payable } from './crypto-config';
import { CryptoLedger, IngestResult, Invoice, TransferSource } from './crypto-ledger';
import { IncomingTransfer } from './watchers/types';

/** The event a transfer nobody's invoice claims is filed under — recorded, not processed as a payment. */
export const UNMATCHED_TRANSFER_EVENT = 'crypto.transfer.unmatched';

/**
 * Stablecoin payments straight to the merchant's own wallets — USDT/USDC on
 * TRON, TON, Ethereum and Solana — with no processor in between.
 *
 * The flow:
 * 1. At checkout the customer picks a network and token. The invoice reserves
 *    an amount unique among open invoices — the price plus a fraction of a
 *    cent — because on most of these chains the amount is the only thing a
 *    transfer carries that can say which order it pays.
 * 2. The customer sends exactly that amount to the wallet shown.
 * 3. The watcher (`CryptoWatcherScheduler`) polls each chain's public API for
 *    transfers into the wallets with an open invoice; an external indexer may
 *    also post them to `/webhooks/crypto`. Both go through {@link ingest}.
 * 4. A matched transfer becomes a webhook event, and the ordinary processor
 *    asks {@link getIntentStatus}, which checks the transfer against the
 *    invoice before reporting the intent paid.
 *
 * Money that arrives without matching an open invoice — the round amount, a
 * payment after the grace period, a second payment — is recorded as an
 * unmatched transfer for an admin to assign, never dropped.
 */
@RegisterConnector(RAILS.CRYPTO)
@Injectable()
export class CryptoAdapter implements Connector {
  private readonly logger = new Logger(CryptoAdapter.name);
  readonly ledger: CryptoLedger;

  constructor(private readonly prisma: PrismaService) {
    this.ledger = new CryptoLedger(prisma);
  }

  rail(): string {
    return RAILS.CRYPTO;
  }

  capabilities(): ConnectorCapabilities {
    return {
      supportedModes: ['PAYMENT'],
      requiresRedirect: false,
      selectableMethods: true,
      currencies: [...STABLECOIN_CURRENCIES],
    };
  }

  private async settings(): Promise<CryptoSettings> {
    const settings = await loadCryptoSettings(this.prisma);
    if (!settings || !settings.isActive) {
      throw new BadRequestException('Crypto payments are not enabled');
    }
    return settings;
  }

  /**
   * An external indexer authenticates with a shared secret in
   * `x-webhook-secret`. Fails closed when none is configured: a forged
   * "confirmed" transfer would otherwise fulfil an order for free.
   */
  verifyWebhook({ headers, config }: WebhookVerifyInput): boolean {
    const expectedSecret = config.webhookSecret;
    if (!expectedSecret) return false;
    const secret = headers['x-webhook-secret'];
    return !!secret && safeTimingSafeEqual(expectedSecret, secret);
  }

  // ─── Checkout ─────────────────────────────────────────────────

  /** Every network/token pair a customer can pay with right now. */
  async listMethods(): Promise<PaymentMethod[]> {
    const settings = await loadCryptoSettings(this.prisma);
    if (!settings?.isActive) return [];

    const methods: PaymentMethod[] = [];
    for (const chainId of CHAIN_IDS) {
      if (!payable(settings, chainId)) continue;
      const chain = CHAINS[chainId];
      for (const [token, info] of Object.entries(chain.tokens)) {
        methods.push({
          id: `${chainId}_${token}`,
          type: 'crypto',
          name: `${token} · ${chain.name} (${chain.network})`,
          metadata: {
            chain: chainId,
            chainName: chain.name,
            network: chain.network,
            token,
            contractAddress: info?.contractAddress,
          },
        });
      }
    }
    return methods;
  }

  /**
   * Open an invoice.
   *
   * Requires `cryptoChainId` and `cryptoToken` (or `metadata.cryptoChain` /
   * `metadata.cryptoToken`). Prices must be in dollars: a stablecoin is worth
   * one, and anything else would need an exchange rate this rail does not
   * have — selling a 1000 ₽ product for 1000 USDT is the failure it prevents.
   */
  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const chainId = input.cryptoChainId || input.metadata?.cryptoChain;
    const token = String(input.cryptoToken || input.metadata?.cryptoToken || '').toUpperCase();

    if (!isChainId(chainId) || !token) {
      throw new BadRequestException(
        `Choose a network and a token to pay with (networks: ${CHAIN_IDS.join(', ')})`,
      );
    }
    const chain = CHAINS[chainId];
    const tokenInfo = chain.tokens[token as keyof typeof chain.tokens];
    if (!tokenInfo) {
      throw new BadRequestException(
        `${token} is not accepted on ${chain.name}. Accepted: ${Object.keys(chain.tokens).join(', ')}`,
      );
    }
    if (!STABLECOIN_CURRENCIES.has(String(input.currency).toUpperCase())) {
      throw new BadRequestException(
        `Crypto payments are only available for prices in USD; this one is in ${input.currency}`,
      );
    }

    const settings = await this.settings();
    if (!payable(settings, chainId)) {
      throw new BadRequestException(`Payments on ${chain.name} are not being accepted right now`);
    }
    const receiverAddress = settings.wallets[chainId] as string;

    const expiresAt = new Date(Date.now() + settings.expiryMinutes * 60 * 1000);
    const invoiceId = `crypto_${chainId}_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const memo = input.orderId.slice(-8).toUpperCase();

    const invoice = await this.ledger.reserve({
      invoiceId,
      orderId: input.metadata?.order_id ?? input.orderId,
      chain: chainId,
      token,
      receiverAddress,
      baseAmountRaw: toOnChainAmount(input.amount, tokenInfo.decimals),
      decimals: tokenInfo.decimals,
      memo,
      expiresAt,
    });

    const amount = formatUnits(invoice.amountRaw, tokenInfo.decimals);
    this.logger.log(
      `Crypto invoice ${invoiceId}: ${amount} ${token} on ${chainId} → ${receiverAddress}`,
    );

    return {
      providerIntentId: invoiceId,
      checkoutUrl: undefined,
      expiresAt,
      metadata: {
        chain: chainId,
        chainName: chain.name,
        network: chain.network,
        token,
        contractAddress: tokenInfo.contractAddress,
        decimals: tokenInfo.decimals,
        receiverAddress,
        amount,
        baseAmount: formatUnits(invoice.baseAmountRaw, tokenInfo.decimals),
        onChainAmount: invoice.amountRaw,
        memo,
        explorerUrl: chain.explorerUrl,
        requiredConfirmations: chain.confirmations,
        paymentUri: paymentUri(chainId, tokenInfo, receiverAddress, invoice.amountRaw, amount),
        order_id: input.metadata?.order_id ?? input.orderId,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  /**
   * Hand back the open invoice, or open a new one?
   *
   * A new one when the customer picked a different network or token — the old
   * invoice's address and amount are wrong for what they are about to send —
   * or when the old one's timer has run out. Never once a transfer has been
   * seen against it: that payment is on its way and must land on this intent.
   */
  async replaceLiveIntent(
    intent: { providerIntentId: string | null; status: string; snapshot: unknown },
    input: CreateIntentInput,
  ): Promise<boolean> {
    if (intent.status !== 'created' || !intent.providerIntentId) return false;
    const snapshot = (intent.snapshot as Record<string, any>) || {};
    if (snapshot.observedTransfer) return false;

    const invoice = await this.ledger.findByInvoiceId(intent.providerIntentId);
    if (!invoice || invoice.status !== 'awaiting' || invoice.txHash) return false;

    const chain = input.cryptoChainId || input.metadata?.cryptoChain;
    const token = String(input.cryptoToken || input.metadata?.cryptoToken || '').toUpperCase();
    const switched = (!!chain && chain !== invoice.chain) || (!!token && token !== invoice.token);
    return switched || invoice.expiresAt.getTime() <= Date.now();
  }

  /** Give the replaced invoice's amount back. */
  async releaseIntent(intent: { providerIntentId: string | null }): Promise<void> {
    if (intent.providerIntentId) await this.ledger.cancel(intent.providerIntentId);
  }

  /**
   * What the checkout page needs to show for an invoice: where to send, how
   * much exactly, until when, and how far along the payment is.
   */
  async describeIntent(intent: {
    providerIntentId: string | null;
    status: string;
    snapshot: unknown;
  }): Promise<Record<string, any> | null> {
    if (!intent.providerIntentId) return null;
    const snapshot = (intent.snapshot as Record<string, any>) || {};
    const invoice = await this.ledger.findByInvoiceId(intent.providerIntentId);
    if (!invoice) return null;
    const chainId = invoice.chain as ChainId;
    const chain = CHAINS[chainId];
    const tokenInfo = chain?.tokens[invoice.token as keyof typeof chain.tokens];
    const amount = formatUnits(invoice.amountRaw, invoice.decimals);

    return {
      type: 'crypto',
      invoiceStatus: invoice.status,
      chain: chainId,
      chainName: chain?.name ?? chainId,
      network: chain?.network ?? chainId,
      token: invoice.token,
      contractAddress: tokenInfo?.contractAddress ?? snapshot.contractAddress,
      address: invoice.receiverAddress,
      amount,
      amountRaw: invoice.amountRaw,
      baseAmount: formatUnits(invoice.baseAmountRaw, invoice.decimals),
      memo: invoice.memo,
      expiresAt: invoice.expiresAt.toISOString(),
      paymentUri: tokenInfo
        ? paymentUri(chainId, tokenInfo, invoice.receiverAddress, invoice.amountRaw, amount)
        : invoice.receiverAddress,
      confirmations: invoice.confirmations,
      requiredConfirmations: chain?.confirmations ?? 1,
      txHash: invoice.txHash,
      txUrl: invoice.txHash && chain ? txExplorerUrl(chainId, invoice.txHash) : null,
    };
  }

  // ─── Settlement ───────────────────────────────────────────────

  /**
   * Where the payment for an invoice stands.
   *
   * A transfer is only "paid" once it is checked against the invoice — same
   * chain, same token, our wallet, at least the amount — and deep enough to
   * be final. A transfer that fails the check does not fail the order: it is
   * somebody's money arriving with the wrong shape, for an admin to look at,
   * and the customer may still pay correctly.
   */
  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerIntentId },
    });
    const snapshot = (intent?.snapshot as Record<string, any>) || {};
    const chain = snapshot.chain || providerIntentId.split('_')[1];
    const current = (intent?.status ?? 'created') as IntentStatusResult['status'];
    const pending: IntentStatusResult['status'] = current === 'opened' ? 'opened' : 'created';

    const observed = snapshot.observedTransfer as Record<string, any> | undefined;
    if (observed) {
      const check = this.validateObservedTransfer(snapshot, observed);
      if (!check.ok) {
        this.logger.warn(
          `Crypto tx ${observed.txHash} does not pay ${providerIntentId}: ${check.reason}`,
        );
        return {
          status: pending,
          metadata: { chain, reason: check.reason, txHash: observed.txHash },
        };
      }

      const required = Number(
        snapshot.requiredConfirmations ?? CHAINS[chain as ChainId]?.confirmations ?? 1,
      );
      const confirmations = Number(observed.confirmations ?? 0);
      if (observed.isFinal === true || confirmations >= required) {
        return {
          status: 'paid',
          // The transfer was checked against the invoice above — receiver,
          // token and amount — so the settlement is verified here even though
          // no fiat amount is reported.
          amountVerifiedByAdapter: true,
          metadata: { txHash: observed.txHash, confirmations, chain },
          // The whole snapshot, not just the transfer: applyStateTransition
          // replaces the stored snapshot with this, and the invoice details
          // are what support needs when a customer asks about the payment.
          providerData: { ...snapshot, observedTransfer: { ...observed, validated: true } },
        };
      }
      return {
        status: 'opened',
        metadata: {
          txHash: observed.txHash,
          confirmations,
          requiredConfirmations: required,
          chain,
        },
      };
    }

    const invoice = await this.ledger.findByInvoiceId(providerIntentId);
    if (invoice && (invoice.status === 'expired' || invoice.status === 'cancelled')) {
      return { status: 'expired', metadata: { chain, reason: `invoice_${invoice.status}` } };
    }

    return {
      status: pending,
      metadata: {
        chain,
        awaiting_payment: true,
        receiverAddress: snapshot.receiverAddress,
        amount: snapshot.amount,
        token: snapshot.token,
      },
    };
  }

  /**
   * Record a transfer the watcher or an indexer saw, and attach it to the
   * intent it pays so the processor can settle it.
   */
  async ingest(
    observed: IncomingTransfer & { memo?: string | null },
    source: TransferSource,
  ): Promise<IngestResult> {
    const result = await this.ledger.ingest(observed, source);
    if (result.invoice && result.transfer.invoiceId === result.invoice.id) {
      await this.attach(result.invoice, {
        chain: result.transfer.chain,
        txHash: result.transfer.txHash,
        from: result.transfer.fromAddress,
        to: result.transfer.toAddress,
        token: result.transfer.token,
        amount: result.transfer.amountRaw,
        confirmations: result.transfer.confirmations,
        isFinal: result.transfer.isFinal,
      });
    }
    return result;
  }

  /**
   * Put the transfer on the intent's snapshot, where getIntentStatus reads it.
   * `manual` marks an admin's attribution, which is trusted for the amount.
   */
  async attach(invoice: Invoice, transfer: Record<string, any>): Promise<void> {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerIntentId: invoice.invoiceId, rail: RAILS.CRYPTO },
    });
    if (!intent) {
      this.logger.warn(`Crypto invoice ${invoice.invoiceId} has no payment intent to settle`);
      return;
    }
    const snapshot = (intent.snapshot as Record<string, any>) || {};
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        txHash: transfer.txHash,
        snapshot: { ...snapshot, observedTransfer: { ...transfer } },
      },
    });
  }

  /**
   * A transfer reported by an external indexer.
   *
   * Expected payload:
   * `{ chain, txHash, from?, to, token, amount, confirmations, memo?, blockNumber? }`,
   * where `amount` is either in the token's smallest unit or a decimal.
   *
   * The event id carries the payment's phase — seen, final — so the report
   * that a transfer became final is a new event rather than a duplicate of the
   * first sighting. With one id per transaction the second report was
   * dropped as already handled and the order stayed open forever.
   */
  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    const { chain, txHash, from, to, token, amount, confirmations, memo } = rawPayload ?? {};

    if (!isChainId(chain) || !txHash || !to || !token) {
      throw new BadRequestException(
        'Invalid crypto webhook: chain, txHash, to and token are required',
      );
    }
    const tokenSymbol = String(token).toUpperCase();
    const tokenInfo =
      CHAINS[chain].tokens[tokenSymbol as keyof (typeof CHAINS)[typeof chain]['tokens']];
    if (!tokenInfo) {
      throw new BadRequestException(
        `Invalid crypto webhook: ${tokenSymbol} is not accepted on ${chain}`,
      );
    }
    const amountRaw = parseRawAmount(amount, tokenInfo.decimals);
    if (amountRaw === null) {
      throw new BadRequestException('Invalid crypto webhook: unreadable amount');
    }
    const depth = Number(confirmations ?? 0);
    const isFinal = depth >= CHAINS[chain].confirmations;

    const result = await this.ingest(
      {
        chain,
        txHash: String(txHash),
        token: tokenSymbol,
        from: from ?? null,
        to: String(to),
        amountRaw: amountRaw.toString(),
        decimals: tokenInfo.decimals,
        confirmations: depth,
        isFinal,
        memo: memo ? String(memo) : null,
      },
      'webhook',
    );

    return this.eventFor(result);
  }

  /** The webhook event a recorded transfer turns into. */
  eventFor(result: IngestResult): WebhookParseResult {
    const { transfer, invoice } = result;
    const phase = result.phase ?? (transfer.isFinal ? 'final' : 'seen');
    const payload = {
      chain: transfer.chain,
      txHash: transfer.txHash,
      from: transfer.fromAddress,
      to: transfer.toAddress,
      token: transfer.token,
      amount: transfer.amountRaw,
      confirmations: transfer.confirmations,
      confirmed: transfer.isFinal,
      transferId: transfer.id,
    };

    if (!invoice || transfer.invoiceId !== invoice.id) {
      return {
        webhookId: `crypto_${transfer.chain}_${transfer.txHash}_unmatched`,
        eventType: UNMATCHED_TRANSFER_EVENT,
        entityId: transfer.id,
        rail: RAILS.CRYPTO,
        payload,
      };
    }
    return {
      webhookId: `crypto_${transfer.chain}_${transfer.txHash}_${phase}`,
      eventType: phase === 'final' ? 'payment.paid' : 'payment.confirming',
      entityId: invoice.invoiceId,
      rail: RAILS.CRYPTO,
      payload,
    };
  }

  /**
   * Check an observed transfer against the invoice it is attached to: same
   * chain and token, our wallet, at least the invoiced amount. An admin's
   * manual attribution is trusted on the amount — they looked.
   */
  private validateObservedTransfer(
    snapshot: Record<string, any>,
    observed: Record<string, any>,
  ): { ok: boolean; reason?: string } {
    if (snapshot.chain && observed.chain && snapshot.chain !== observed.chain) {
      return { ok: false, reason: 'chain_mismatch' };
    }
    if (
      snapshot.token &&
      observed.token &&
      String(snapshot.token).toUpperCase() !== String(observed.token).toUpperCase()
    ) {
      return { ok: false, reason: 'token_mismatch' };
    }
    if (snapshot.receiverAddress && observed.to && isChainId(snapshot.chain)) {
      if (
        receiverKey(snapshot.chain, snapshot.receiverAddress) !==
        receiverKey(snapshot.chain, observed.to)
      ) {
        return { ok: false, reason: 'receiver_mismatch' };
      }
    }
    if (observed.manual === true) return { ok: true };

    const decimals = Number(snapshot.decimals ?? 0);
    const expected = parseRawAmount(snapshot.onChainAmount, 0);
    const got = parseRawAmount(observed.amount, decimals);
    if (expected === null || got === null) {
      return { ok: false, reason: 'unparseable_amount' };
    }
    if (got < expected) {
      return { ok: false, reason: 'amount_too_low' };
    }
    return { ok: true };
  }
}
