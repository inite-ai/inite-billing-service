import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { RAILS } from '../common/connectors/rail';
import { CryptoAdapter } from '../adapters/crypto/crypto.adapter';
import {
  CHAINS,
  CHAIN_IDS,
  ChainId,
  EVM_CHAIN_IDS,
  EVM_WALLET_KEY,
  STABLECOIN_CURRENCIES,
  isEvm,
  isValidAddress,
  txExplorerUrl,
} from '../adapters/crypto/chains';
import {
  CRYPTO_PROVIDER_CODE,
  MAX_FX_MARKUP_PERCENT,
  DEFAULT_EXPIRY_MINUTES,
  DEFAULT_LATE_GRACE_HOURS,
  CryptoSettings,
  parseCryptoSettings,
  payable,
  watchable,
} from '../adapters/crypto/crypto-config';
import { LedgerError, LIVE_INVOICE_STATUSES } from '../adapters/crypto/crypto-ledger';
import { formatUnits } from '../adapters/crypto/amount.util';
import { CryptoWatcherScheduler } from '../workers/crypto-watcher.scheduler';

const SECRET_KEYS = [
  'etherscanApiKey',
  'trongridApiKey',
  'toncenterApiKey',
  'webhookSecret',
] as const;
type SecretKey = (typeof SECRET_KEYS)[number];

export interface CryptoSettingsUpdate {
  isActive?: boolean;
  wallets?: Partial<Record<ChainId, string | null>>;
  expiryMinutes?: number;
  lateGraceHours?: number;
  etherscanApiKey?: string | null;
  trongridApiKey?: string | null;
  toncenterApiKey?: string | null;
  solanaRpcUrl?: string | null;
  webhookSecret?: string | null;
  fxMarkupPercent?: number;
  /** Units per US dollar; null or '' removes a pinned rate. */
  fixedRates?: Record<string, string | number | null>;
  /** Per-EVM-network RPC override; null removes it. */
  rpcUrls?: Partial<Record<ChainId, string | null>>;
}

function mask(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.length > 4 ? `••••${value.slice(-4)}` : '••••';
}

function mapLedgerError(error: unknown): never {
  if (error instanceof LedgerError) {
    if (error.kind === 'not_found') throw new NotFoundException(error.message);
    if (error.kind === 'conflict') throw new ConflictException(error.message);
    throw new BadRequestException(error.message);
  }
  throw error;
}

/**
 * The admin side of the crypto rail: where the wallets and API keys are set,
 * what every invoice is doing, and what to do with money that arrived without
 * a recognisable invoice.
 */
@Injectable()
export class CryptoAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: PaymentOrchestratorService,
    private readonly watcher: CryptoWatcherScheduler,
  ) {}

  private adapter(): CryptoAdapter {
    return this.orchestrator.getAdapter(RAILS.CRYPTO) as CryptoAdapter;
  }

  private provider() {
    return this.prisma.paymentProvider.findUnique({ where: { code: CRYPTO_PROVIDER_CODE } });
  }

  /**
   * Everything the settings page shows. Wallet addresses are public and shown
   * in full; API keys and the webhook secret only as their last characters.
   */
  async getSettings() {
    const provider = await this.provider();
    const config = ((provider?.config as Record<string, any>) || {}) as Record<string, any>;
    const settings =
      parseCryptoSettings(provider) ?? parseCryptoSettings({ isActive: false, config: {} })!;

    const [liveInvoices, unmatchedTransfers] = await Promise.all([
      this.prisma.cryptoInvoice.count({ where: { status: { in: LIVE_INVOICE_STATUSES } } }),
      this.prisma.cryptoTransfer.count({ where: { status: 'unmatched' } }),
    ]);
    const polls = new Map(this.watcher.lastStatus().map((s) => [s.chain, s]));

    return {
      provider: provider
        ? { id: provider.id, isActive: provider.isActive, exists: true }
        : { id: null, isActive: false, exists: false },
      expiryMinutes: settings.expiryMinutes,
      lateGraceHours: settings.lateGraceHours,
      solanaRpcUrl: settings.solanaRpcUrl ?? null,
      secrets: Object.fromEntries(SECRET_KEYS.map((key) => [key, mask(config[key])])) as Record<
        SecretKey,
        string | null
      >,
      chains: CHAIN_IDS.map((chain) => {
        const stored = typeof config.wallets?.[chain] === 'string' ? config.wallets[chain] : null;
        return {
          chain,
          evm: isEvm(chain),
          // What this network actually uses — its own address, or the shared EVM one.
          effectiveWallet: settings.wallets[chain] ?? null,
          name: CHAINS[chain].name,
          network: CHAINS[chain].network,
          tokens: Object.keys(CHAINS[chain].tokens),
          confirmations: CHAINS[chain].confirmations,
          wallet: stored,
          walletValid: stored ? isValidAddress(chain, stored) : null,
          watchable: watchable(settings, chain),
          payable: payable(settings, chain),
          poll: polls.get(chain) ?? null,
        };
      }),
      evmWallet:
        typeof config.wallets?.[EVM_WALLET_KEY] === 'string'
          ? config.wallets[EVM_WALLET_KEY]
          : null,
      rpcUrls: settings.rpcUrls,
      liveInvoices,
      unmatchedTransfers,
      fx: await this.fxOverview(settings),
    };
  }

  /**
   * The rates checkout would use right now, for every currency something is
   * priced in (and every pinned one) — so an admin sees what a 9 000 ₽
   * product will actually cost in USDT before a customer does.
   */
  private async fxOverview(settings: CryptoSettings) {
    const priced = await this.prisma.price.findMany({
      where: { isActive: true },
      select: { currency: true },
      distinct: ['currency'],
    });
    const currencies = [
      ...new Set([
        ...priced.map((p) => p.currency.toUpperCase()),
        ...Object.keys(settings.fixedRates),
      ]),
    ]
      .filter((c) => !STABLECOIN_CURRENCIES.has(c))
      .sort();

    const adapter = this.adapter();
    const rates = [];
    for (const currency of currencies) {
      const quote = await adapter.fx.quote(currency, settings).catch(() => null);
      const stored = await this.prisma.fxRate.findUnique({ where: { currency } });
      rates.push({
        currency,
        perUsd: quote?.perUsd.toString() ?? null,
        source: quote?.source ?? null,
        publishedAt: quote?.publishedAt ?? null,
        fetchedAt: stored?.fetchedAt ?? null,
        pinned: settings.fixedRates[currency] ?? null,
        available: !!quote,
      });
    }
    return { markupPercent: settings.fxMarkupPercent, fixedRates: settings.fixedRates, rates };
  }

  /** Fetch rates now instead of waiting for the hourly refresh. */
  async refreshRates() {
    try {
      return await this.adapter().fx.refresh({ force: true });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Change the settings. Merged over what is stored — a field left out keeps
   * its value, `null` removes it — and every wallet is checked as an address
   * on its own chain first, because a typo there sends customers' money to an
   * address nobody holds the key to.
   */
  async updateSettings(update: CryptoSettingsUpdate) {
    const provider = await this.provider();
    const config = { ...((provider?.config as Record<string, any>) || {}) };
    // Keys come from the list of networks, never from the request: an
    // unknown network is refused, and the stored map is rebuilt rather than
    // written into by a caller-chosen name.
    const requested = update.wallets ?? {};
    // `EVM` is the one address every EVM network shares.
    const walletKeys: string[] = [...CHAIN_IDS, EVM_WALLET_KEY];
    const unknown = Object.keys(requested).filter((key) => !walletKeys.includes(key));
    if (unknown.length) throw new BadRequestException(`Unknown network: ${unknown.join(', ')}`);

    const stored = (config.wallets || {}) as Record<string, unknown>;
    const wallets = new Map<string, string>();
    for (const key of walletKeys) {
      const hasUpdate = Object.prototype.hasOwnProperty.call(requested, key);
      const value = hasUpdate ? (requested as Record<string, unknown>)[key] : stored[key];
      if (value === null || value === undefined || value === '') continue;
      const trimmed = String(value).trim();
      const checkAs: ChainId = key === EVM_WALLET_KEY ? 'ETH' : (key as ChainId);
      if (hasUpdate && !isValidAddress(checkAs, trimmed)) {
        const label = key === EVM_WALLET_KEY ? 'EVM (0x…)' : CHAINS[key as ChainId].name;
        throw new BadRequestException(`${trimmed} is not a valid ${label} address`);
      }
      wallets.set(key, trimmed);
    }
    config.wallets = Object.fromEntries(wallets);

    if (update.rpcUrls !== undefined) {
      const urls = new Map<string, string>(
        Object.entries((config.rpcUrls as Record<string, string>) || {}).filter(([c]) =>
          EVM_CHAIN_IDS.includes(c as ChainId),
        ),
      );
      for (const chain of EVM_CHAIN_IDS) {
        if (!Object.prototype.hasOwnProperty.call(update.rpcUrls, chain)) continue;
        const url = update.rpcUrls[chain];
        if (url === null || url === '') urls.delete(chain);
        else if (!/^https:\/\/\S+$/.test(String(url))) {
          throw new BadRequestException(`The RPC URL for ${CHAINS[chain].name} must be https://`);
        } else urls.set(chain, String(url));
      }
      config.rpcUrls = Object.fromEntries(urls);
    }

    if (update.expiryMinutes !== undefined) {
      if (
        !Number.isInteger(update.expiryMinutes) ||
        update.expiryMinutes < 10 ||
        update.expiryMinutes > 24 * 60
      ) {
        throw new BadRequestException('The payment window must be between 10 minutes and 24 hours');
      }
      config.expiryMinutes = update.expiryMinutes;
    }
    if (update.lateGraceHours !== undefined) {
      if (
        !Number.isInteger(update.lateGraceHours) ||
        update.lateGraceHours < 1 ||
        update.lateGraceHours > 24 * 7
      ) {
        throw new BadRequestException(
          'The grace period for late payments must be between 1 hour and 7 days',
        );
      }
      config.lateGraceHours = update.lateGraceHours;
    }
    if (update.solanaRpcUrl !== undefined) {
      if (update.solanaRpcUrl === null || update.solanaRpcUrl === '') {
        delete config.solanaRpcUrl;
      } else if (!/^https:\/\/[^\s]+$/.test(update.solanaRpcUrl)) {
        throw new BadRequestException('The Solana RPC URL must be an https:// address');
      } else {
        config.solanaRpcUrl = update.solanaRpcUrl;
      }
    }
    for (const key of SECRET_KEYS) {
      const value = update[key];
      if (value === undefined) continue;
      if (value === null || value === '') delete config[key];
      else config[key] = String(value).trim();
    }

    if (update.fxMarkupPercent !== undefined) {
      const markup = Number(update.fxMarkupPercent);
      if (!Number.isFinite(markup) || markup < 0 || markup > MAX_FX_MARKUP_PERCENT) {
        throw new BadRequestException(`The markup must be between 0 and ${MAX_FX_MARKUP_PERCENT}%`);
      }
      config.fxMarkupPercent = markup;
    }
    if (update.fixedRates !== undefined) {
      const pinned = new Map<string, string>(
        Object.entries((config.fixedRates as Record<string, string>) || {}).filter(([c]) =>
          /^[A-Z]{3}$/.test(c),
        ),
      );
      for (const [raw, rate] of Object.entries(update.fixedRates ?? {})) {
        const currency = raw.toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) {
          throw new BadRequestException(`${raw} is not a currency code`);
        }
        if (STABLECOIN_CURRENCIES.has(currency)) {
          throw new BadRequestException(`${currency} is already a dollar; it needs no rate`);
        }
        if (rate === null || rate === '') {
          pinned.delete(currency);
          continue;
        }
        const text = String(rate).trim().replace(',', '.');
        if (!/^\d+(\.\d+)?$/.test(text) || Number(text) <= 0) {
          throw new BadRequestException(
            `The rate for ${currency} must be a positive number of ${currency} per US dollar`,
          );
        }
        pinned.set(currency, text);
      }
      config.fixedRates = Object.fromEntries(pinned);
    }

    const next = parseCryptoSettings({ isActive: true, config })!;
    const willBeActive = update.isActive ?? provider?.isActive ?? false;
    if (willBeActive && !CHAIN_IDS.some((chain) => payable(next, chain))) {
      throw new BadRequestException(
        'Add at least one wallet the rail can watch before turning crypto payments on ',
      );
    }

    if (provider) {
      await this.prisma.paymentProvider.update({
        where: { id: provider.id },
        data: { config, ...(update.isActive !== undefined ? { isActive: update.isActive } : {}) },
      });
    } else {
      await this.prisma.paymentProvider.create({
        data: {
          code: CRYPTO_PROVIDER_CODE,
          name: 'Crypto (stablecoins)',
          isActive: update.isActive ?? false,
          supportedModes: ['PAYMENT'],
          currencies: ['USD'],
          countries: ['GLOBAL'],
          config: {
            expiryMinutes: DEFAULT_EXPIRY_MINUTES,
            lateGraceHours: DEFAULT_LATE_GRACE_HOURS,
            ...config,
          },
        },
      });
    }
    return this.getSettings();
  }

  /** Invoices, newest first, with the order each one is for. */
  async listInvoices(filter: { status?: string; limit?: number }) {
    const invoices = await this.prisma.cryptoInvoice.findMany({
      where: filter.status ? { status: filter.status } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
    const intents = await this.prisma.paymentIntent.findMany({
      where: { providerIntentId: { in: invoices.map((i) => i.invoiceId) }, rail: RAILS.CRYPTO },
      include: { order: { include: { price: { include: { product: true } } } } },
    });
    const byInvoice = new Map(intents.map((intent) => [intent.providerIntentId, intent]));

    return invoices.map((invoice) => {
      const intent = byInvoice.get(invoice.invoiceId);
      return {
        id: invoice.id,
        invoiceId: invoice.invoiceId,
        chain: invoice.chain,
        token: invoice.token,
        receiverAddress: invoice.receiverAddress,
        amount: formatUnits(invoice.amountRaw, invoice.decimals),
        baseAmount: formatUnits(invoice.baseAmountRaw, invoice.decimals),
        status: invoice.status,
        expiresAt: invoice.expiresAt,
        txHash: invoice.txHash,
        txUrl: invoice.txHash ? txExplorerUrl(invoice.chain as ChainId, invoice.txHash) : null,
        confirmations: invoice.confirmations,
        requiredConfirmations: CHAINS[invoice.chain as ChainId]?.confirmations ?? 1,
        paidAt: invoice.paidAt,
        createdAt: invoice.createdAt,
        intent: intent ? { id: intent.id, status: intent.status } : null,
        order: intent?.order
          ? {
              id: intent.order.id,
              status: intent.order.status,
              userId: intent.order.userId,
              amount: intent.order.amount,
              currency: intent.order.currency,
              product: intent.order.price?.product?.name ?? null,
            }
          : null,
      };
    });
  }

  /** Transfers, newest first — by default the ones waiting for an admin. */
  async listTransfers(filter: { status?: string; limit?: number }) {
    const transfers = await this.prisma.cryptoTransfer.findMany({
      where: { status: filter.status ?? 'unmatched' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
      include: { invoice: true },
    });
    const suggestedIds = transfers
      .map((t) => t.suggestedInvoiceId)
      .filter((id): id is string => !!id);
    const suggested = new Map(
      (await this.prisma.cryptoInvoice.findMany({ where: { id: { in: suggestedIds } } })).map(
        (invoice) => [invoice.id, invoice],
      ),
    );

    return transfers.map((transfer) => {
      const suggestion = transfer.suggestedInvoiceId
        ? suggested.get(transfer.suggestedInvoiceId)
        : null;
      return {
        id: transfer.id,
        chain: transfer.chain,
        token: transfer.token,
        txHash: transfer.txHash,
        txUrl: txExplorerUrl(transfer.chain as ChainId, transfer.txHash),
        from: transfer.fromAddress,
        to: transfer.toAddress,
        amount: formatUnits(transfer.amountRaw, transfer.decimals),
        confirmations: transfer.confirmations,
        isFinal: transfer.isFinal,
        source: transfer.source,
        status: transfer.status,
        note: transfer.note,
        resolvedBy: transfer.resolvedBy,
        blockTime: transfer.blockTime,
        createdAt: transfer.createdAt,
        invoice: transfer.invoice
          ? {
              id: transfer.invoice.id,
              invoiceId: transfer.invoice.invoiceId,
              status: transfer.invoice.status,
            }
          : null,
        suggestion: suggestion
          ? {
              id: suggestion.id,
              invoiceId: suggestion.invoiceId,
              amount: formatUnits(suggestion.amountRaw, suggestion.decimals),
              status: suggestion.status,
              createdAt: suggestion.createdAt,
            }
          : null,
      };
    });
  }

  /**
   * Attribute an unmatched transfer to an invoice and settle its order.
   *
   * Refused when the order can no longer be paid — it has expired, or was
   * paid some other way — because then there is nothing to settle and the
   * money is owed back to the customer instead; that is an explicit decision,
   * not something to do by attaching it here.
   */
  async assign(transferId: string, invoiceRowId: string, adminId: string, note?: string) {
    const invoice = await this.prisma.cryptoInvoice.findUnique({ where: { id: invoiceRowId } });
    if (!invoice) throw new NotFoundException(`Invoice not found: ${invoiceRowId}`);
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerIntentId: invoice.invoiceId, rail: RAILS.CRYPTO },
    });
    if (!intent) throw new NotFoundException('That invoice has no payment to settle');
    if (!['created', 'opened'].includes(intent.status)) {
      throw new ConflictException(
        `That order's payment is already ${intent.status}. Refund the customer, or open a new order for them and assign the transfer to its invoice.`,
      );
    }
    const live = await this.prisma.paymentIntent.findFirst({
      where: {
        orderId: intent.orderId,
        status: { in: ['created', 'opened'] },
        NOT: { id: intent.id },
      },
    });
    if (live) {
      throw new ConflictException(
        'This order has a newer invoice; assign the transfer to that one',
      );
    }

    const assigned = await this.adapter()
      .ledger.assign(transferId, invoiceRowId, adminId, note)
      .catch(mapLedgerError);
    const adapter = this.adapter();
    await adapter.attach(assigned.invoice, {
      chain: assigned.transfer.chain,
      txHash: assigned.transfer.txHash,
      from: assigned.transfer.fromAddress,
      to: assigned.transfer.toAddress,
      token: assigned.transfer.token,
      amount: assigned.transfer.amountRaw,
      confirmations: assigned.transfer.confirmations,
      isFinal: assigned.transfer.isFinal,
      manual: true,
      resolvedBy: adminId,
    });

    const status = await adapter.getIntentStatus(assigned.invoice.invoiceId);
    if (status.status !== intent.status && ['opened', 'paid'].includes(status.status)) {
      await this.orchestrator.applyStateTransition(intent.id, status.status, status.providerData);
    }
    return { transferId, invoiceId: assigned.invoice.invoiceId, paymentStatus: status.status };
  }

  async ignore(transferId: string, adminId: string, note: string) {
    if (!note?.trim()) throw new BadRequestException('Say why the transfer is being set aside');
    const transfer = await this.adapter()
      .ledger.ignore(transferId, adminId, note.trim())
      .catch(mapLedgerError);
    return { transferId: transfer.id, status: transfer.status };
  }

  /** Run the watcher now instead of waiting for the next tick. */
  pollNow() {
    return this.watcher.poll();
  }
}
