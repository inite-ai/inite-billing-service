import { Injectable, Logger } from '@nestjs/common';
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

/**
 * Chain-specific configuration
 */
interface ChainConfig {
  name: string;
  chainId: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeToken: string;
  /** Minimum confirmations to consider transaction final */
  confirmations: number;
  tokens: Record<
    string,
    {
      contractAddress: string;
      decimals: number;
    }
  >;
}

interface CryptoProviderConfig {
  /** Receiver addresses per chain */
  wallets: Record<string, string>;
  /** Chain configurations */
  chains: Record<string, ChainConfig>;
  /** Callback URL for payment status updates */
  callbackUrl?: string;
  /** Payment expiry in minutes */
  expiryMinutes: number;
}

/**
 * Supported chains and their default configs
 */
const DEFAULT_CHAINS: Record<string, Omit<ChainConfig, 'rpcUrl'>> = {
  ETH: {
    name: 'Ethereum',
    chainId: '1',
    explorerUrl: 'https://etherscan.io',
    nativeToken: 'ETH',
    confirmations: 12,
    tokens: {
      USDT: { contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      USDC: { contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    },
  },
  SOL: {
    name: 'Solana',
    chainId: 'mainnet-beta',
    explorerUrl: 'https://solscan.io',
    nativeToken: 'SOL',
    confirmations: 1,
    tokens: {
      USDT: { contractAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
      USDC: { contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    },
  },
  TON: {
    name: 'TON',
    chainId: 'mainnet',
    explorerUrl: 'https://tonviewer.com',
    nativeToken: 'TON',
    confirmations: 1,
    tokens: {
      USDT: { contractAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', decimals: 6 },
      USDC: { contractAddress: 'EQC61IQRl0_la95nfD8TQE4ioIjN7q3T_HQPGHDWe4AGNT0r', decimals: 6 },
    },
  },
  TRON: {
    name: 'TRON',
    chainId: 'mainnet',
    explorerUrl: 'https://tronscan.org',
    nativeToken: 'TRX',
    confirmations: 19,
    tokens: {
      USDT: { contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
      USDC: { contractAddress: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', decimals: 6 },
    },
  },
};

/**
 * Crypto payment adapter — USDT/USDC multi-chain support
 *
 * Supported chains: ETH, SOL, TON, TRON
 * Supported tokens: USDT, USDC
 *
 * Flow:
 * 1. User selects chain + token at checkout
 * 2. Backend generates payment invoice with receiver address + amount + memo
 * 3. User sends transaction from their wallet
 * 4. Backend monitors chain for incoming transaction (via RPC/indexer/webhook)
 * 5. On confirmation threshold met, apply state transition to paid
 *
 * Monitoring strategies (configured per chain):
 * - RPC polling: getTransactionReceipt / getBalance checks
 * - Indexer webhook: blockchain indexer pushes tx confirmations
 * - Manual confirmation: admin verifies and updates status
 */
@RegisterConnector(RAILS.CRYPTO)
@Injectable()
export class CryptoAdapter implements Connector {
  private readonly logger = new Logger(CryptoAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getConfig(): Promise<CryptoProviderConfig> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: 'CRYPTO' },
    });

    if (!provider || !provider.isActive) {
      throw new Error('CRYPTO payment provider is not configured or inactive');
    }

    const config = (provider.config as Record<string, any>) || {};

    // Merge default chain configs with custom overrides
    const chains: Record<string, ChainConfig> = {};
    for (const [chainId, defaults] of Object.entries(DEFAULT_CHAINS)) {
      const customChain = config.chains?.[chainId] || {};
      chains[chainId] = {
        ...defaults,
        rpcUrl: customChain.rpcUrl || config[`${chainId.toLowerCase()}RpcUrl`] || '',
        ...customChain,
      } as ChainConfig;
    }

    return {
      wallets: config.wallets || {},
      chains,
      callbackUrl: config.callbackUrl,
      expiryMinutes: config.expiryMinutes || 60,
    };
  }

  rail(): string {
    return RAILS.CRYPTO;
  }

  capabilities(): ConnectorCapabilities {
    return {
      supportedModes: ['PAYMENT'],
      requiresRedirect: false,
    };
  }

  /** The indexer authenticates with a shared secret in x-webhook-secret. Fails
   * closed when unset (a forged "confirmed" tx would trigger free fulfilment). */
  verifyWebhook({ headers, config }: WebhookVerifyInput): boolean {
    const expectedSecret = config.webhookSecret;
    if (!expectedSecret) return false;
    const secret = headers['x-webhook-secret'];
    return !!secret && safeTimingSafeEqual(expectedSecret, secret);
  }

  /**
   * Validate chain and token selection
   */
  private validateChainToken(
    chain: string,
    token: string,
    config: CryptoProviderConfig,
  ): { chainConfig: ChainConfig; receiverAddress: string } {
    const chainConfig = config.chains[chain];
    if (!chainConfig) {
      throw new Error(
        `Unsupported chain: ${chain}. Supported: ${Object.keys(config.chains).join(', ')}`,
      );
    }

    if (!chainConfig.tokens[token]) {
      throw new Error(
        `Token ${token} not supported on ${chain}. Supported: ${Object.keys(chainConfig.tokens).join(', ')}`,
      );
    }

    const receiverAddress = config.wallets[chain];
    if (!receiverAddress) {
      throw new Error(
        `No receiver wallet configured for chain ${chain}. Configure wallets.${chain} in provider settings.`,
      );
    }

    return { chainConfig, receiverAddress };
  }

  /**
   * Create a crypto payment invoice
   *
   * Required metadata:
   * - cryptoChain: 'ETH' | 'SOL' | 'TON' | 'TRON'
   * - cryptoToken: 'USDT' | 'USDC'
   *
   * Amount is expected in the currency of the order (e.g. USD).
   * For stablecoins, 1 USDT ≈ 1 USD — no conversion needed.
   */
  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const chain = input.cryptoChainId || input.metadata?.cryptoChain;
    const token = input.cryptoToken || input.metadata?.cryptoToken;

    if (!chain || !token) {
      throw new Error('Crypto adapter requires cryptoChain and cryptoToken (e.g. ETH + USDT)');
    }

    const config = await this.getConfig();
    const { chainConfig, receiverAddress } = this.validateChainToken(chain, token, config);

    const tokenConfig = chainConfig.tokens[token];
    const expiresAt = new Date(Date.now() + config.expiryMinutes * 60 * 1000);

    // Amount in token's smallest unit
    const rawAmount = input.amount;
    const onChainAmount = BigInt(
      Math.round(rawAmount * Math.pow(10, tokenConfig.decimals)),
    ).toString();

    // Generate a unique memo/tag for payment identification
    const memo = this.generateMemo(input.orderId);

    const invoiceId = `crypto_${chain}_${Date.now()}_${input.orderId.slice(-8)}`;

    this.logger.log(
      `Created crypto invoice ${invoiceId}: ${rawAmount} ${token} on ${chain} → ${receiverAddress}`,
    );

    return {
      providerIntentId: invoiceId,
      checkoutUrl: undefined, // No hosted checkout — client wallet UX
      expiresAt,
      metadata: {
        chain,
        chainName: chainConfig.name,
        token,
        contractAddress: tokenConfig.contractAddress,
        decimals: tokenConfig.decimals,
        receiverAddress,
        amount: rawAmount.toString(),
        onChainAmount,
        memo,
        explorerUrl: chainConfig.explorerUrl,
        requiredConfirmations: chainConfig.confirmations,
        order_id: input.orderId,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  /**
   * Get payment status
   *
   * In production, this queries the blockchain via RPC or indexer
   * to check if the expected transfer arrived at the receiver address.
   *
   * Current implementation checks the PaymentProvider metadata
   * for manual confirmations or indexer-pushed updates.
   */
  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    // Look up the payment intent to get chain info
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerIntentId: providerIntentId },
    });

    const snapshot = (intent?.snapshot as Record<string, any>) || {};
    const chain = snapshot.chain || providerIntentId.split('_')[1];

    // Check if we have a confirmed txHash
    if (snapshot.txHash && snapshot.confirmations >= (snapshot.requiredConfirmations || 1)) {
      return {
        status: 'paid',
        metadata: {
          txHash: snapshot.txHash,
          confirmations: snapshot.confirmations,
          chain,
        },
        providerData: snapshot,
      };
    }

    // Check expiry
    if (snapshot.expiresAt && new Date(snapshot.expiresAt) < new Date()) {
      return {
        status: 'expired',
        metadata: { chain, reason: 'payment_expired' },
      };
    }

    // Check if transaction is found but not yet confirmed
    if (snapshot.txHash) {
      return {
        status: 'opened',
        metadata: {
          txHash: snapshot.txHash,
          confirmations: snapshot.confirmations || 0,
          requiredConfirmations: snapshot.requiredConfirmations,
          chain,
        },
      };
    }

    return {
      status: 'created',
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
   * Confirm a crypto payment transaction
   * Called by blockchain indexer webhook or admin manual confirmation
   */
  async confirmTransaction(
    providerIntentId: string,
    txHash: string,
    confirmations: number,
  ): Promise<IntentStatusResult> {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerIntentId: providerIntentId },
    });

    if (!intent) {
      throw new Error(`Payment intent not found: ${providerIntentId}`);
    }

    const snapshot = (intent.snapshot as Record<string, any>) || {};
    const requiredConfirmations = snapshot.requiredConfirmations || 1;

    const status = confirmations >= requiredConfirmations ? 'paid' : 'opened';

    // Update intent with tx info
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        txHash,
        snapshot: {
          ...snapshot,
          txHash,
          confirmations,
          confirmedAt: status === 'paid' ? new Date().toISOString() : undefined,
        },
      },
    });

    this.logger.log(
      `Crypto tx ${txHash}: ${confirmations}/${requiredConfirmations} confirmations → ${status}`,
    );

    return {
      status: status as IntentStatusResult['status'],
      metadata: {
        txHash,
        confirmations,
        requiredConfirmations,
        chain: snapshot.chain,
      },
    };
  }

  async listMethods(): Promise<PaymentMethod[]> {
    const config = await this.getConfig();
    const methods: PaymentMethod[] = [];

    for (const [chainId, chainConfig] of Object.entries(config.chains)) {
      // Only list chains that have a wallet configured
      if (!config.wallets[chainId]) continue;

      for (const token of Object.keys(chainConfig.tokens)) {
        methods.push({
          id: `${chainId}_${token}`,
          type: 'crypto',
          name: `${token} on ${chainConfig.name}`,
          metadata: {
            chain: chainId,
            chainName: chainConfig.name,
            token,
            contractAddress: chainConfig.tokens[token].contractAddress,
            explorerUrl: chainConfig.explorerUrl,
          },
        });
      }
    }

    return methods;
  }

  /**
   * Handle webhook from blockchain indexer
   *
   * Expected payload:
   * {
   *   chain: 'ETH' | 'SOL' | 'TON' | 'TRON',
   *   txHash: string,
   *   from: string,
   *   to: string,
   *   token: string,
   *   amount: string,
   *   confirmations: number,
   *   memo?: string,
   *   blockNumber?: number,
   * }
   */
  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    const { chain, txHash, to, token, amount, confirmations, memo } = rawPayload;

    if (!chain || !txHash) {
      throw new Error('Invalid crypto webhook: missing chain or txHash');
    }

    // Try to find the payment intent by memo or receiver address
    const entityId = memo || txHash;

    const confirmed = confirmations >= (DEFAULT_CHAINS[chain]?.confirmations || 1);

    return {
      webhookId: `crypto_${chain}_${txHash}`,
      eventType: confirmed ? 'payment.paid' : 'payment.confirming',
      entityId,
      rail: 'CRYPTO',
      payload: {
        chain,
        txHash,
        to,
        token,
        amount,
        confirmations,
        memo,
        confirmed,
      },
    };
  }

  /**
   * Generate a unique memo/tag for payment identification
   * Used on chains that support memos (TON, etc.)
   */
  private generateMemo(orderId: string): string {
    // Use last 8 chars of orderId as a short identifier
    return orderId.slice(-8).toUpperCase();
  }

  /**
   * Get supported chains and tokens info (for frontend)
   */
  async getSupportedChains(): Promise<
    Array<{
      chain: string;
      name: string;
      tokens: string[];
      hasWallet: boolean;
    }>
  > {
    const config = await this.getConfig();

    return Object.entries(config.chains).map(([chainId, chainConfig]) => ({
      chain: chainId,
      name: chainConfig.name,
      tokens: Object.keys(chainConfig.tokens),
      hasWallet: !!config.wallets[chainId],
    }));
  }
}
