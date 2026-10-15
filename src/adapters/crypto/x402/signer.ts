import { ApiKeyStamper } from '@turnkey/api-key-stamper';
import { TurnkeyClient, assertActivityCompleted, assertNonNull } from '@turnkey/http';
import { getAddress, type Hex } from 'viem';

/**
 * Who signs the transactions that put x402 payments on chain.
 *
 * That wallet only ever pays network fees: the payer's signature fixes the
 * amount, the recipient and the deadline, so whoever holds this key cannot
 * redirect a payment, only spend the fee balance. Even so its private key is
 * never in billing — it lives in Turnkey's enclave, billing holds an API key
 * that can only ask for signatures, and a Turnkey policy lets that API key
 * sign nothing but `transferWithAuthorization` on USDC on Base to our wallet
 * (docs/x402.md). A stolen API key can then only settle real payments to us.
 */
export interface RelayerSigner {
  readonly address: `0x${string}`;
  /** Sign a serialized unsigned transaction; returns the signed one, ready to broadcast. */
  signTransaction(unsigned: Hex): Promise<Hex>;
}

export interface TurnkeySignerConfig {
  organizationId: string;
  apiPublicKey: string;
  apiPrivateKey: string;
  /** The Turnkey wallet account that pays the fees. */
  address: string;
  baseUrl?: string;
}

export class TurnkeySigner implements RelayerSigner {
  readonly address: `0x${string}`;
  private readonly client: TurnkeyClient;

  constructor(private readonly config: TurnkeySignerConfig) {
    this.address = getAddress(config.address);
    this.client = new TurnkeyClient(
      { baseUrl: config.baseUrl ?? 'https://api.turnkey.com' },
      new ApiKeyStamper({ apiPublicKey: config.apiPublicKey, apiPrivateKey: config.apiPrivateKey }),
    );
  }

  async signTransaction(unsigned: Hex): Promise<Hex> {
    const { activity } = await this.client.signTransaction({
      type: 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2',
      organizationId: this.config.organizationId,
      timestampMs: String(Date.now()),
      parameters: {
        signWith: this.address,
        type: 'TRANSACTION_TYPE_ETHEREUM',
        unsignedTransaction: unsigned.replace(/^0x/, ''),
      },
    });
    // A transaction the policy does not allow comes back rejected — the
    // relayer reports it as a failed settlement, never retries around it.
    assertActivityCompleted(activity);
    const signed = assertNonNull(activity?.result?.signTransactionResult?.signedTransaction);
    return `0x${signed.replace(/^0x/, '')}`;
  }
}

/**
 * The relayer's signer from the environment, or null when x402 cannot settle
 * here. There is deliberately no way to configure a raw private key.
 */
export function signerFromEnv(
  env: Record<string, string | undefined> = process.env,
): RelayerSigner | null {
  const organizationId = env.TURNKEY_ORGANIZATION_ID;
  const apiPublicKey = env.TURNKEY_API_PUBLIC_KEY;
  const apiPrivateKey = env.TURNKEY_API_PRIVATE_KEY;
  const address = env.X402_RELAYER_ADDRESS;
  if (!organizationId || !apiPublicKey || !apiPrivateKey || !address) return null;
  return new TurnkeySigner({
    organizationId,
    apiPublicKey,
    apiPrivateKey,
    address,
    baseUrl: env.TURNKEY_API_BASE_URL,
  });
}
