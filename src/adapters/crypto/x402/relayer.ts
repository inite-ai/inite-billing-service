import {
  createPublicClient,
  encodeFunctionData,
  http,
  serializeTransaction,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { base } from 'viem/chains';
import { CHAINS } from '../chains';
import { DecodedPayment, X402Error, typedData, usdcAddress } from './protocol';
import { RelayerSigner } from './signer';

export const USDC_ABI = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'authorizationState',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/** The only call the relayer ever makes — what the Turnkey policy allows by selector. */
export const TRANSFER_WITH_AUTHORIZATION_SELECTOR = '0xcf092995';

export interface RelayerLimits {
  /** Refuse to settle while the network asks more than this per gas. */
  maxFeePerGasWei: bigint;
  /** The most one settlement may cost in fees. */
  maxTxCostWei: bigint;
  /** The most all settlements may cost in fees over 24 hours. */
  dailyBudgetWei: bigint;
}

export const DEFAULT_LIMITS: RelayerLimits = {
  // Base usually charges a few thousandths of a gwei; 0.5 gwei is a fee spike.
  maxFeePerGasWei: 500_000_000n,
  // ~90k gas at the cap: well under a dollar.
  maxTxCostWei: 100_000_000_000_000n,
  // 0.003 ETH a day — thousands of ordinary settlements.
  dailyBudgetWei: 3_000_000_000_000_000n,
};

export function baseClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl || CHAINS.BASE.evm!.rpcUrl, { timeout: 15_000 }),
  }) as PublicClient;
}

/**
 * Puts a checked x402 authorization on chain.
 *
 * Nothing is sent that the chain would refuse: the signature is checked
 * (smart-wallet signatures included), the authorization must be unused, the
 * payer must hold the amount, and the call is simulated first — a USDC
 * blacklist or pause shows up there, not as a reverted transaction we paid
 * for. Fees are capped per transaction and per day.
 *
 * The caller serializes calls to {@link send}: the relayer's account nonce is
 * read fresh each time, so two concurrent sends would collide.
 */
export class Relayer {
  constructor(
    private readonly signer: RelayerSigner,
    private readonly client: PublicClient,
    private readonly limits: RelayerLimits = DEFAULT_LIMITS,
  ) {}

  get address() {
    return this.signer.address;
  }

  /** Whether the authorization was already used on chain — by us or by anyone who saw it. */
  async used(payment: DecodedPayment): Promise<boolean> {
    return this.client.readContract({
      address: usdcAddress(),
      abi: USDC_ABI,
      functionName: 'authorizationState',
      args: [payment.authorization.from, payment.authorization.nonce],
    });
  }

  /** Signature, unused nonce, balance. Throws {@link X402Error} on the first that fails. */
  async verify(payment: DecodedPayment): Promise<void> {
    const a = payment.authorization;
    const valid = await this.client
      .verifyTypedData({
        address: a.from,
        signature: payment.signature,
        blockTag: 'latest',
        ...typedData(a),
      })
      .catch(() => false);
    if (!valid)
      throw new X402Error('invalid_signature', 'The signature does not match the authorization');

    if (await this.used(payment)) {
      throw new X402Error('authorization_used', 'This authorization was already used');
    }
    const balance = await this.client.readContract({
      address: usdcAddress(),
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [a.from],
    });
    if (balance < a.value)
      throw new X402Error('insufficient_funds', 'The payer does not hold enough USDC');
  }

  /**
   * Simulate, price, sign and broadcast. `spentToday` is what settlements
   * have cost in fees over the last 24 hours.
   */
  async send(
    payment: DecodedPayment,
    spentToday: bigint,
  ): Promise<{ hash: Hex; maxCostWei: bigint }> {
    const a = payment.authorization;
    const data = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transferWithAuthorization',
      args: [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, payment.signature],
    });
    const to = usdcAddress();

    let gas: bigint;
    try {
      gas = await this.client.estimateGas({ account: this.signer.address, to, data });
    } catch (error: any) {
      throw new X402Error(
        'settlement_would_fail',
        `The transfer would be refused on chain: ${error?.shortMessage ?? error?.message}`,
      );
    }
    gas = (gas * 12n) / 10n;

    const fees = await this.client.estimateFeesPerGas();
    if (fees.maxFeePerGas > this.limits.maxFeePerGasWei) {
      throw new X402Error(
        'network_busy',
        'Network fees are unusually high right now; try again in a few minutes',
      );
    }
    const maxCostWei = gas * fees.maxFeePerGas;
    if (
      maxCostWei > this.limits.maxTxCostWei ||
      spentToday + maxCostWei > this.limits.dailyBudgetWei
    ) {
      throw new X402Error(
        'fee_budget_exhausted',
        'x402 settlement is paused for now; pay the invoice by transfer instead',
      );
    }

    const nonce = await this.client.getTransactionCount({
      address: this.signer.address,
      blockTag: 'pending',
    });
    const unsigned = serializeTransaction({
      type: 'eip1559',
      chainId: CHAINS.BASE.evm!.chainId,
      nonce,
      to,
      data,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      value: 0n,
    });
    const signed = await this.signer.signTransaction(unsigned);
    const hash = await this.client.sendRawTransaction({ serializedTransaction: signed });
    return { hash, maxCostWei };
  }

  /** The receipt, or null if the transaction is not in a block within `timeoutMs`. */
  async receipt(hash: Hex, timeoutMs: number): Promise<TransactionReceipt | null> {
    try {
      return await this.client.waitForTransactionReceipt({
        hash,
        timeout: timeoutMs,
        pollingInterval: 1_000,
      });
    } catch {
      return null;
    }
  }
}
