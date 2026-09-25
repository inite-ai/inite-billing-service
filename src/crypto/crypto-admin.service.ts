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
  isValidAddress,
  txExplorerUrl,
} from '../adapters/crypto/chains';
import {
  CRYPTO_PROVIDER_CODE,
  DEFAULT_EXPIRY_MINUTES,
  DEFAULT_LATE_GRACE_HOURS,
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
      liveInvoices,
      unmatchedTransfers,
    };
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
    const wallets: Record<string, string> = { ...(config.wallets || {}) };

    for (const [chain, address] of Object.entries(update.wallets ?? {})) {
      if (!CHAIN_IDS.includes(chain as ChainId)) {
        throw new BadRequestException(`Unknown network: ${chain}`);
      }
      if (address === null || address === '') {
        delete wallets[chain];
        continue;
      }
      const trimmed = String(address).trim();
      if (!isValidAddress(chain as ChainId, trimmed)) {
        throw new BadRequestException(
          `${trimmed} is not a valid ${CHAINS[chain as ChainId].name} address`,
        );
      }
      wallets[chain] = trimmed;
    }
    config.wallets = wallets;

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

    const next = parseCryptoSettings({ isActive: true, config })!;
    const willBeActive = update.isActive ?? provider?.isActive ?? false;
    if (willBeActive && !CHAIN_IDS.some((chain) => payable(next, chain))) {
      throw new BadRequestException(
        'Add at least one wallet the rail can watch before turning crypto payments on (Ethereum also needs an Etherscan API key)',
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
